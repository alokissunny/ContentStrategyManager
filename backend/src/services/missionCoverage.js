/*
 * Analysis › Mission coverage — how the account's recent Instagram posts spread
 * across the four content missions (Attract / Nurture / Position / Convert).
 *
 * Posts: a history kept on the report (`missionCoverage.history`, newest first,
 * ≤ HISTORY_MAX). The first visit seeds it from the last 10 published Instagram
 * posts (postRemix.loadRemixPosts — the month cache Post remix and the Next-post
 * idea agent read; images already in S3). "Fetch recent" (fetchRecentMissions)
 * reads the newest posts again and adds ONLY those newer than the newest one
 * already stored — only they are downloaded and analysed.
 * Each post not analysed yet goes to ONE model call (caption + its first image)
 * that returns mission, pillar and a one-line reason; results are kept on the
 * brand report (`missionCoverage.posts`) so a post is analysed once, and copied
 * into igMissionTags / igPillarTags so the Next-post idea agent sees the same
 * tags. Percentages and "what needs attention" are worked out in code.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { loadRemixPosts } = require('./postRemix');
const { fetchRecentPosts, plainPost, preparePostMedia } = require('./brandVoice');
const { completeText } = require('./llmComplete');
const { parseJsonAnswer } = require('./nextPostIdea');
const { isS3Configured, getObjectBytes, getPresignedMediaUrl } = require('./s3Client');
const { LANGUAGES } = require('../utils/appLocale');
const { MISSION_TAG_V, withMissionRules } = require('../utils/contentMissions');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'mission-coverage.md');
const MISSIONS = ['attract', 'nurture', 'position', 'convert'];
const PILLARS = ['passion', 'skills', 'story'];
const MISSION_SAY = { attract: 'Attract', nurture: 'Nurture', position: 'Position', convert: 'Convert' };
const IMAGE_PX = 640;
const HISTORY_MAX = 60; // posts kept and counted
const FETCH_LIMIT = 20; // newest posts read by Fetch recent (no "since" filter upstream)
// The content audit (studio, 2026-11-21): the last 20 published posts — pillar and mission
// shares, the pillar × mission grid and the gaps. Shown on Analysis and read by the
// Next-post idea agent, so both speak about the same posts.
const AUDIT_WINDOW = 20;
const PILLAR_SAY = { skills: 'Skills', passion: 'Passion', story: 'Story' };
const WEAK_PILLAR_PCT = 20; // a pillar under this share of the window is a gap
const THIN_MISSION_PCT = 10;

function coverageModel() {
  // same model as the Next-post idea agent (Claude Sonnet 5.5) unless overridden
  return process.env.MISSION_COVERAGE_MODEL || process.env.NEXT_IDEA_MODEL || 'claude-sonnet-5-5';
}

let promptCache = null;
const loadPrompt = () => (promptCache ||= withMissionRules(fs.readFileSync(PROMPT_FILE, 'utf8')));
const idOf = (p) => String(p?.externalId || p?.url || '').trim();
const tagKey = (id) => String(id).replace(/[.$]/g, '_');
const oneOf = (list, v) => (list.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : '');
const clip = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function reportFor(userId, username) {
  return BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({ createdAt: -1 });
}

/** The post's first stored image, small, as base64 JPEG — null when there is none. */
async function firstImage(post) {
  const key = (post.frameKeys || [])[0];
  if (!key || !isS3Configured()) return null;
  try {
    const { buffer } = await getObjectBytes(key);
    const small = await sharp(buffer).resize(IMAGE_PX, IMAGE_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    return { mediaType: 'image/jpeg', data: small.toString('base64') };
  } catch (err) {
    console.warn(`[missionCoverage] image ${key} unreadable:`, err.message);
    return null;
  }
}

function languageRule(locale) {
  if (!locale || locale === 'en' || !LANGUAGES[locale]) return 'Write `reason` in English.';
  return `Write \`reason\` in ${LANGUAGES[locale]}.`;
}

/** One model call: mission + pillar + reason for each post in `todo`. */
async function classify(todo, { locale, debug }) {
  const model = coverageModel();
  const system = loadPrompt().split('{{LANGUAGE_RULE}}').join(languageRule(locale));
  const rows = todo.map((p, i) => ({
    n: i + 1,
    id: idOf(p),
    type: p.type || 'post',
    date: p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : '',
    caption: clip(p.caption, 900) || '(no caption)',
    likes: Number(p.likesCount) || 0,
    comments: Number(p.commentsCount) || 0,
  }));
  const pics = await Promise.all(todo.map(firstImage));
  const images = pics.filter(Boolean);
  const labels = pics.map((img, i) => (img ? `post ${i + 1}` : null)).filter(Boolean);
  const user = `${JSON.stringify(rows, null, 1)}\n\nImages attached, in order: ${labels.join(', ') || 'none'}.`;

  const started = Date.now();
  const run = (text) => completeText({
    model, system, user: text, images, maxTokens: 4000, kind: 'strategist', reasoningEffort: 'low', timeoutMs: 180000,
  });
  let res = await run(user);
  let parsed;
  try {
    parsed = parseJsonAnswer(res.text);
  } catch {
    res = await run(`${user}\n\nReturn ONLY the JSON object, one row per post.`);
    parsed = parseJsonAnswer(res.text);
  }
  const usage = res.usage || {};
  const { estimatePlanCostUsd } = require('./weeklyPlan');
  const costUsd = estimatePlanCostUsd(res.model || model, usage.input_tokens || 0, usage.output_tokens || 0, usage.cached_tokens || 0, usage.cache_write_tokens || 0);
  const elapsedMs = Date.now() - started;
  debug?.push({
    source: 'Mission coverage',
    model: res.model || model,
    prompt: `${system}\n\n--- USER ---\n${user}`,
    output: res.text,
    elapsedMs,
    note: `${todo.length} post(s) · ${images.length} image(s)`,
    usage: {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      estimatedCostUsd: costUsd,
    },
  });
  console.log(`[missionCoverage] ${res.model || model} · ${todo.length} posts · ${images.length} images · ${usage.input_tokens || 0}+${usage.output_tokens || 0} tok · ~$${costUsd.toFixed(4)} · ${elapsedMs}ms`);

  const wanted = new Set(rows.map((r) => r.id));
  const out = {};
  for (const r of Array.isArray(parsed.posts) ? parsed.posts : []) {
    const id = String(r?.id || '').trim();
    const mission = oneOf(MISSIONS, r?.mission);
    if (!wanted.has(id) || !mission) continue;
    out[id] = { mission, pillar: oneOf(PILLARS, r?.pillar), reason: clip(r?.reason, 200), at: new Date(), v: MISSION_TAG_V };
  }
  return { tags: out, model: res.model || model };
}

/** Whole percentages that add up to 100 (largest remainder). */
function percentsOf(counts, total, keys = MISSIONS) {
  if (!total) return Object.fromEntries(keys.map((m) => [m, 0]));
  const raw = keys.map((m) => ({ m, v: (counts[m] * 100) / total }));
  const out = Object.fromEntries(raw.map(({ m, v }) => [m, Math.floor(v)]));
  let left = 100 - Object.values(out).reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)))
    .forEach(({ m }) => { if (left > 0) { out[m] += 1; left -= 1; } });
  return out;
}

/**
 * The pillar side: how many posts talk about Skills / Passion / Story, and how
 * each pillar spreads over the missions (matrix[pillar][mission] = posts).
 */
function pillarMixOf(rows) {
  const withPillar = rows.filter((r) => PILLARS.includes(r.pillar));
  const counts = Object.fromEntries(PILLARS.map((p) => [p, withPillar.filter((r) => r.pillar === p).length]));
  const raw = percentsOf(counts, withPillar.length, PILLARS);
  const matrix = Object.fromEntries(PILLARS.map((p) => [p,
    Object.fromEntries(MISSIONS.map((m) => [m, withPillar.filter((r) => r.pillar === p && r.mission === m).length]))]));
  return { pillars: { total: withPillar.length, counts, percents: raw, matrix } };
}

/**
 * The content audit over tagged posts (newest first, already cut to the window):
 * mission + pillar shares, the grid, and the gaps in the order they matter —
 * missing missions (the one the objective asks for first), pillars under
 * WEAK_PILLAR_PCT, then thin missions. `topics` (topic map) adds how many
 * Skills / Passion / Story topics the studio has not posted on yet.
 */
function auditOf(tagged, { topics = [], objective = '' } = {}) {
  const total = tagged.length;
  const counts = Object.fromEntries(MISSIONS.map((m) => [m, tagged.filter((r) => r.mission === m).length]));
  const percents = percentsOf(counts, total);
  const { pillars } = pillarMixOf(tagged);
  const open = Object.fromEntries(PILLARS.map((pl) => [pl, topics.filter((t) => t.pillar === pl && t.status !== 'covered').length]));
  const gaps = [];
  if (total >= 5) {
    // what the studio says it wants decides which missing mission comes first
    const wants = String(objective || '').toLowerCase();
    const first = /inquir|enquir|lead|client|book|sale|sell|consult|project/.test(wants) ? 'convert'
      : /expert|authority|known for|trust/.test(wants) ? 'position'
        : /reach|grow|follower|audience|discover/.test(wants) ? 'attract' : 'convert';
    const order = [first, ...['convert', 'position', 'nurture', 'attract'].filter((m) => m !== first)];
    order.filter((m) => !counts[m]).forEach((m) => gaps.push({
      kind: 'mission', id: m, count: 0, of: total, percent: 0,
      say: `${MISSION_SAY[m]} is 0 of your last ${total} posts.`,
    }));
    if (pillars.total) {
      PILLARS.map((pl) => ({ pl, pct: pillars.percents[pl] }))
        .filter((x) => x.pct < WEAK_PILLAR_PCT)
        .sort((a, b) => a.pct - b.pct)
        .forEach(({ pl, pct }) => gaps.push({
          kind: 'pillar', id: pl, count: pillars.counts[pl], of: pillars.total, percent: pct, openTopics: open[pl],
          say: `${PILLAR_SAY[pl]} is ${pct}% of your last ${pillars.total} posts.`,
        }));
    }
    order.filter((m) => counts[m] && percents[m] <= THIN_MISSION_PCT).forEach((m) => gaps.push({
      kind: 'mission', id: m, count: counts[m], of: total, percent: percents[m],
      say: `${MISSION_SAY[m]} is ${counts[m]} of your last ${total} posts.`,
    }));
  }
  return { window: total, missions: { counts, percents }, pillars, openTopics: open, gaps };
}

/** What the studio should hear: missing missions first, then the thinnest, and what leads. */
function attentionOf(counts, total) {
  if (!total) return { focus: [], lead: '', note: '' };
  const missing = MISSIONS.filter((m) => !counts[m]);
  const min = Math.min(...MISSIONS.map((m) => counts[m]));
  const max = Math.max(...MISSIONS.map((m) => counts[m]));
  const lead = MISSIONS.filter((m) => counts[m] === max)[0];
  const focus = missing.length ? missing : (max - min >= 2 ? MISSIONS.filter((m) => counts[m] === min) : []);
  const names = (list) => list.map((m) => MISSION_SAY[m]).join(list.length > 2 ? ', ' : ' and ');
  let note;
  if (missing.length) {
    note = `${names(missing)} ${missing.length === 1 ? 'is' : 'are'} missing from your last ${total} posts.`;
  } else if (focus.length) {
    note = `${names(focus)} ${focus.length === 1 ? 'has' : 'have'} the fewest posts lately.`;
  } else {
    note = `Your last ${total} posts are spread evenly across the four missions.`;
  }
  if (max > 0 && (missing.length || focus.length)) note += ` ${MISSION_SAY[lead]} leads with ${counts[lead]} of ${total}.`;
  return { focus, lead, note };
}

/**
 * The account's mission coverage. Analyses only posts not analysed before
 * (all of them with `refresh`). Returns { total, counts, percents, focus, lead,
 * note, posts:[…], analysedAt, model }.
 */
const timeOf = (p) => (p?.timestamp ? new Date(p.timestamp).getTime() || 0 : 0);
const newestFirst = (list) => [...list].sort((a, b) => timeOf(b) - timeOf(a));

/** The stored history, or — first visit — the last 10 Instagram posts, which become it. */
async function historyOf(report, userId, handle) {
  const kept = report?.missionCoverage?.history;
  if (Array.isArray(kept) && kept.length) return { posts: kept, seeded: false };
  const snapshot = await loadRemixPosts(userId, handle);
  return { posts: newestFirst((snapshot.posts || []).filter((p) => idOf(p))).slice(0, HISTORY_MAX), seeded: true };
}

/** Writes the whole coverage block (dotted paths cannot be set on a null field). */
function saveCoverage(report, patch, extraSet = {}) {
  if (!report) return Promise.resolve();
  const next = { ...(report.missionCoverage || {}), ...patch };
  report.missionCoverage = next; // later reads in this request see it
  return BrandAnalysisReport.updateOne({ _id: report._id }, { $set: { ...extraSet, missionCoverage: next } })
    .catch((err) => console.warn('[missionCoverage] could not store:', err.message));
}

/**
 * The audit reads the last AUDIT_WINDOW posts; a history seeded from the 10-post
 * cache is filled once with older posts (fetched, prepared and stored like Fetch
 * recent — but any unknown post counts, not only newer ones). Tried once per
 * account (`backfillTriedAt`), so a short account never re-fetches.
 */
async function backfillHistory(report, userId, handle, kept) {
  if (!report || kept.length >= AUDIT_WINDOW || report.missionCoverage?.backfillTriedAt) return kept;
  try {
    const known = new Set(kept.map(idOf));
    const fresh = await fetchRecentPosts(userId, handle, AUDIT_WINDOW);
    const unknown = (fresh.posts || []).map(plainPost).filter((p) => idOf(p) && !known.has(idOf(p)));
    let added = [];
    if (unknown.length) {
      const prepared = await preparePostMedia(userId, handle, unknown);
      added = (prepared.posts || []).map(plainPost);
    }
    const history = newestFirst([...added, ...kept]).slice(0, HISTORY_MAX);
    await saveCoverage(report, { history, backfillTriedAt: new Date(), lastFetchedAt: new Date() });
    console.log(`[missionCoverage] @${handle} audit backfill (${fresh.source || '?'}): +${added.length} → ${history.length} posts`);
    return history;
  } catch (err) {
    console.warn(`[missionCoverage] @${handle} audit backfill failed:`, err.message);
    await saveCoverage(report, { backfillTriedAt: new Date() });
    return kept;
  }
}

async function missionCoverage(userId, username, { refresh = false, locale = 'en', debug = null, report: given = null, objective = '' } = {}) {
  const handle = String(username || '').toLowerCase();
  const report = given || await reportFor(userId, handle);
  const history = await historyOf(report, userId, handle);
  if (history.seeded && history.posts.length) await saveCoverage(report, { history: history.posts, lastFetchedAt: new Date() });
  // the audit window: the newest AUDIT_WINDOW posts (the history keeps more)
  const posts = (await backfillHistory(report, userId, handle, history.posts)).slice(0, AUDIT_WINDOW);
  const stored = { ...(report?.missionCoverage?.posts || {}) };

  // tags made under older mission rules (e.g. "a CTA makes it convert") are redone
  const current = (t) => t?.mission && t.v === MISSION_TAG_V;
  const todo = posts.filter((p) => refresh || !current(stored[tagKey(idOf(p))]));
  let model = report?.missionCoverage?.model || '';
  if (todo.length) {
    const result = await classify(todo, { locale, debug });
    model = result.model;
    const set = {};
    for (const [id, tag] of Object.entries(result.tags)) {
      const k = tagKey(id);
      stored[k] = tag;
      if (tag.pillar) set[`igPillarTags.${k}`] = tag.pillar;
    }
    // the Next-post idea agent reads igMissionTags: under older rules it is
    // replaced whole by the current-rule tags, otherwise filled key by key
    const fresh = Object.entries(stored).filter(([, t]) => current(t));
    if ((report?.igMissionTagsV || 0) !== MISSION_TAG_V) {
      set.igMissionTags = Object.fromEntries(fresh.map(([k, t]) => [k, t.mission]));
      set.igMissionTagsV = MISSION_TAG_V;
      if (report) report.igMissionTagsV = MISSION_TAG_V;
    } else {
      for (const id of Object.keys(result.tags)) set[`igMissionTags.${tagKey(id)}`] = result.tags[id].mission;
    }
    await saveCoverage(report, { at: new Date(), model, posts: stored }, set);
  }

  const canSign = isS3Configured();
  const rows = await Promise.all(posts.map(async (p) => {
    const tag = stored[tagKey(idOf(p))] || {};
    const key = (p.frameKeys || [])[0];
    return {
      id: idOf(p),
      url: p.url || '',
      type: p.type || 'post',
      timestamp: p.timestamp || null,
      caption: clip(p.caption, 400),
      likes: Number(p.likesCount) || 0,
      comments: Number(p.commentsCount) || 0,
      image: canSign && key ? await getPresignedMediaUrl(key).catch(() => '') : (p.displayUrl || ''),
      mission: tag.mission || '',
      pillar: tag.pillar || '',
      reason: tag.reason || '',
    };
  }));

  const tagged = rows.filter((r) => r.mission);
  const counts = Object.fromEntries(MISSIONS.map((m) => [m, tagged.filter((r) => r.mission === m).length]));
  const total = tagged.length;
  const topics = report?.contentTerritory?.topics || [];
  const audit = auditOf(tagged, { topics, objective });
  return {
    total,
    window: AUDIT_WINDOW,
    counts,
    percents: percentsOf(counts, total),
    ...attentionOf(counts, total),
    ...pillarMixOf(tagged),
    gaps: audit.gaps,
    openTopics: audit.openTopics,
    posts: rows,
    analysedAt: todo.length ? new Date() : (report?.missionCoverage?.at || null),
    lastFetchedAt: report?.missionCoverage?.lastFetchedAt || null,
    model,
  };
}

/**
 * Fetch recent: reads the newest Instagram posts and adds only those published
 * after the newest post already stored (those are the only ones downloaded and
 * analysed). Known posts get their likes/comments refreshed. Returns the
 * coverage plus `added` (how many new posts).
 */
async function fetchRecentMissions(userId, username, { locale = 'en', debug = null, objective = '' } = {}) {
  const handle = String(username || '').toLowerCase();
  const report = await reportFor(userId, handle);
  const { posts: kept } = await historyOf(report, userId, handle);
  const known = new Map(kept.map((p) => [idOf(p), p]));
  const cutoff = Math.max(0, ...kept.map(timeOf));

  const fresh = await fetchRecentPosts(userId, handle, FETCH_LIMIT);
  const freshPlain = (fresh.posts || []).map(plainPost).filter((p) => idOf(p));
  const newer = freshPlain.filter((p) => !known.has(idOf(p)) && timeOf(p) > cutoff);

  // engagement moves on: refresh the counts of posts already stored
  const counts = new Map(freshPlain.map((p) => [idOf(p), p]));
  const updated = kept.map((p) => {
    const f = counts.get(idOf(p));
    return f ? { ...p, likesCount: f.likesCount, commentsCount: f.commentsCount } : p;
  });

  let added = [];
  if (newer.length) {
    // stores each new post's slides / reel frames in S3 (frameKeys) — only the new ones
    const prepared = await preparePostMedia(userId, handle, newer);
    added = (prepared.posts || []).map(plainPost);
  }
  const history = newestFirst([...added, ...updated]).slice(0, HISTORY_MAX);
  await saveCoverage(report, { history, lastFetchedAt: new Date() });
  console.log(`[missionCoverage] @${handle} fetch recent (${fresh.source || '?'}): ${freshPlain.length} read, ${added.length} new since ${cutoff ? new Date(cutoff).toISOString().slice(0, 10) : 'never'}`);

  const out = await missionCoverage(userId, handle, { locale, debug, report, objective });
  return { ...out, added: added.length, source: fresh.source || '' };
}

module.exports = { missionCoverage, fetchRecentMissions, classify, percentsOf, pillarMixOf, attentionOf, auditOf, reportFor, historyOf, AUDIT_WINDOW, MISSIONS, PILLARS };

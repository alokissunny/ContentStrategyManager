/*
 * Strategy Context Compiler — shrinks raw Brand DNA, competitor dashboards,
 * and project libraries into the compact slices each plan agent actually uses.
 *
 * Compilation is deterministic (no extra LLM). Version ids are content hashes
 * so logs can show when a summary would have been reused. The compact JSON is
 * always included in the request (stateless models cannot look up a version).
 */

const crypto = require('crypto');

const memo = new Map();
const MEMO_CAP = 40;

function memoGet(key, build) {
  if (memo.has(key)) return memo.get(key);
  const value = build();
  if (memo.size >= MEMO_CAP) memo.clear();
  memo.set(key, value);
  return value;
}

function clip(value, max) {
  const s = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function versionOf(prefix, payload) {
  const h = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 8);
  return `${prefix}-${h}`;
}

function splitGuardrails(neverDo) {
  const raw = String(neverDo || '')
    .split(/[\n.;]+/)
    .map((s) => clip(s, 90))
    .filter(Boolean)
    .slice(0, 4);
  const always = ['No invented proof or results'];
  const extra = raw.filter((g) => !/invent/i.test(g));
  return [...always, ...extra].slice(0, 5);
}

function compileBrandContext(brandDna) {
  const dna = brandDna && typeof brandDna === 'object' ? brandDna : {};
  const source = {
    whoYouHelp: clip(dna.whoYouHelp, 140),
    position: clip(dna.position, 140),
    whatYouOffer: clip(dna.whatYouOffer, 140),
    howYouSound: clip(dna.howYouSound, 160),
    neverDo: clip(dna.neverDo, 240),
  };
  const key = versionOf('brand', source);
  return memoGet(key, () => ({
    version: key,
    audience: source.whoYouHelp,
    position: source.position,
    offer: source.whatYouOffer,
    voice: source.howYouSound,
    guardrails: splitGuardrails(source.neverDo),
  }));
}

/** Day writer needs more voice than the strategist, still not visualStyle. */
function compileBrandVoice(brandDna) {
  const dna = brandDna && typeof brandDna === 'object' ? brandDna : {};
  return {
    audience: clip(dna.whoYouHelp, 160),
    position: clip(dna.position, 160),
    offer: clip(dna.whatYouOffer, 160),
    voice: clip(dna.howYouSound, 220),
    firstProblem: clip(dna.firstProblem, 140),
    proof: clip(dna.proof, 140),
    neverDo: clip(dna.neverDo, 200),
  };
}

function competitorConfidence(dashboard) {
  const captions = Number(dashboard?.captionAnalysis?.kpis?.captions) || 0;
  if (captions >= 80) return 'high';
  if (captions >= 30) return 'medium';
  return 'low';
}

function compileCompetitorSignals(cohortInsights) {
  if (!cohortInsights || !cohortInsights.dashboard) {
    const empty = { version: 'competitor-none', confidence: 'none', signals: [], formats: [], hooks: [] };
    return empty;
  }
  const dashboard = cohortInsights.dashboard;
  const ca = dashboard.captionAnalysis || {};
  const formats = (ca.formats || [])
    .slice(0, 3)
    .map((f) => clip(f.label || f.name, 24))
    .filter(Boolean);
  const patterns = (ca.patterns || [])
    .slice(0, 4)
    .map((p) => clip(p.name, 60))
    .filter(Boolean);
  const hooks = (dashboard.hooks || [])
    .slice(0, 3)
    .map((h) => clip(h.hookType || h.name, 48))
    .filter(Boolean);
  const peakTimes = (ca.days || [])
    .slice(0, 3)
    .map((d) => clip([d.label, d.peakTime].filter(Boolean).join(' '), 40))
    .filter(Boolean);
  const source = {
    cohort: cohortInsights.cohort
      ? `${cohortInsights.cohort.businessCategory || ''} ${cohortInsights.cohort.location || ''}`.trim()
      : '',
    formats,
    patterns,
    hooks,
    peakTimes,
    kpis: ca.kpis || {},
  };
  const key = versionOf('competitor', source);
  return memoGet(key, () => {
    const signals = [];
    if (formats.length) signals.push(`${formats.join(' and ')} dominate packaging`);
    patterns.forEach((p) => signals.push(p));
    hooks.forEach((h) => signals.push(`${h} hooks are common`));
    return {
      version: key,
      cohort: clip(source.cohort, 80),
      confidence: competitorConfidence(dashboard),
      formats,
      hooks,
      peakTimes,
      signals: signals.slice(0, 6),
    };
  });
}

function compileAuthority(focusSummary) {
  const funnel = Array.isArray(focusSummary?.funnel) ? focusSummary.funnel : [];
  const scores = {};
  const verdicts = {};
  funnel.forEach((f) => {
    if (!f?.pillar) return;
    scores[f.pillar] = Number(f.score) || 0;
    verdicts[f.pillar] = f.verdict || '';
  });
  return {
    priority: focusSummary?.pillar || 'discovery',
    confidence: focusSummary?.confidence || '',
    scores,
    verdicts,
  };
}

const RECENT_CAPTURES = 10;
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

function noteText(n) {
  if (!n) return '';
  if (typeof n === 'string') return n;
  return n.text || '';
}

function signalsOf(u) {
  if (!Array.isArray(u?.distinctSignals)) return [];
  return u.distinctSignals
    .map((s) => ({
      type: clip(s?.type, 24),
      summary: clip(s?.summary, 220),
    }))
    .filter((s) => s.type || s.summary)
    .slice(0, 16);
}

function asUnderstanding(u) {
  if (!u || typeof u !== 'object') return {};
  if (typeof u.toObject === 'function') return u.toObject();
  return u;
}

function relationshipsOf(u) {
  if (!Array.isArray(u?.relationships)) return [];
  return u.relationships
    .map((r) => ({
      from: clip(r?.from, 220),
      relationship: clip(r?.relationship, 48),
      to: clip(r?.to, 220),
    }))
    .filter((r) => r.from || r.to || r.relationship)
    .slice(0, 16);
}

function conversationCaptureOf(n) {
  const u = asUnderstanding(n.understanding);
  return {
    id: n.id || '',
    captureId: clip(u.captureId || n.id, 48),
    project: n.project,
    originalCapture: clip(u.originalCapture || n.text, 1200),
    whatHappened: clip(u.happened || u.whatHappened, 500),
    intent: clip(u.intent, 320),
    tension: clip(u.difficulty || u.tension, 320),
    action: clip(u.actionTaken || u.action, 320),
    outcome: clip(u.outcome, 320),
    captureSummary: clip(u.summary || u.captureSummary, 500),
    distinctSignals: signalsOf(u),
    sourceStoryId: clip(u.sourceStoryId, 64),
    segmentId: clip(u.segmentId, 64),
    relatedSegmentIds: Array.isArray(u.relatedSegmentIds)
      ? u.relatedSegmentIds.map((id) => clip(id, 64)).filter(Boolean).slice(0, 12)
      : [],
    relationships: relationshipsOf(u),
    verifiedFacts: Array.isArray(u.verifiedFacts)
      ? u.verifiedFacts.map((f) => clip(f, 220)).filter(Boolean).slice(0, 16)
      : [],
    openQuestions: Array.isArray(u.openQuestions)
      ? u.openQuestions.map((q) => clip(q, 180)).filter(Boolean).slice(0, 8)
      : [],
    unresolvedGap: clip(u.missingPiece || u.unresolvedGap, 240),
    knownLimitation: clip(u.knownLimitation, 240),
    visualAssetChoice: clip(u.visualAssetChoice, 24),
    status: clip(u.captureStatus || u.status, 24),
    shown: n.shown || [],
  };
}

/** Newest captures first, across every project — never the full archive. */
function recentCapturesOf(projects, limit = RECENT_CAPTURES) {
  const all = [];
  for (const p of projects || []) {
    for (const n of p.notes || []) {
      const text = clip(noteText(n), 280);
      const assets = (n && n.assets) || [];
      const shown = assets.map((a) => assetOneLiner(a)).filter(Boolean);
      if (!text && !shown.length && !n.understanding) continue;
      all.push({
        id: n.id || '',
        project: p.name,
        text,
        createdAt: n.createdAt || null,
        shown: shown.slice(0, 4),
        assets,
        understanding: n.understanding || null,
      });
    }
  }
  all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return all.slice(0, limit);
}

function conversationSessionOf(rows) {
  if (!rows.length) return [];
  const newest = new Date(rows[0].createdAt || 0).getTime();
  if (!newest) return rows.slice(0, 10);
  return rows.filter((c) => {
    const t = new Date(c.createdAt || 0).getTime();
    return t && Math.abs(newest - t) <= SESSION_WINDOW_MS;
  }).slice(0, 10);
}

function compileProjectTruth(projects) {
  const recent = recentCapturesOf(projects, 10);
  const session = conversationSessionOf(recent);
  const conversationCaptures = (session.length ? session : recent.slice(0, 3))
    .map(conversationCaptureOf)
    .filter((c) => c.originalCapture || c.whatHappened || c.captureSummary);
  const lastThree = recent.slice(0, 3).map((c, i) => ({
    project: c.project,
    text: c.text,
    shown: c.shown,
    planFromThis: i === 0,
  }));
  return {
    conversationCaptures,
    latestCapture: conversationCaptures[0] || lastThree[0] || null,
    lastThree,
  };
}

function compileCalendarSlots(monthCalendar) {
  const emptyDates = (monthCalendar?.emptyDates || []).map((d) => ({
    date: d.date,
    dayOfMonth: d.dayOfMonth,
    day: d.day,
    pillar: d.pillar,
  }));
  const occupiedTopics = (monthCalendar?.occupied || [])
    .map((d) => clip(d.title, 80))
    .filter(Boolean)
    .slice(0, 16);
  return {
    month: monthCalendar?.month || '',
    today: monthCalendar?.today || '',
    emptyDates,
    occupiedTopics,
  };
}

function assetOneLiner(a) {
  const summary = clip(a?.vision?.summary, 80);
  if (summary) return summary;
  return clip(a?.note, 80);
}

function compileAssetIndex(projects) {
  const rows = [];
  for (const c of recentCapturesOf(projects)) {
    for (const a of c.assets || []) {
      if (!a?.key) continue;
      rows.push({
        key: a.key,
        project: c.project,
        summary: assetOneLiner(a),
      });
    }
  }
  return rows.slice(0, 12);
}

const STOP = new Set('the a an and or of to for with in on at from your our this that these those is are be as by it its into out up over under about you we they them their post reel story slide day week content'.split(' '));

function wordsOf(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

function scoreAsset(queryWords, a) {
  const hay = [
    a?.vision?.summary,
    ...(a?.vision?.subjects || []),
    ...(a?.vision?.tags || []),
    a?.note,
  ].filter(Boolean).join(' ').toLowerCase();
  if (!hay || !queryWords.size) return 0;
  let hits = 0;
  queryWords.forEach((w) => { if (hay.includes(w)) hits += 1; });
  return hits;
}

/**
 * After a brief is assigned a date, retrieve a small set of matching photos —
 * not the whole library.
 */
function assetsForDay(projects, dayBrief) {
  const preferred = String(dayBrief?.suggestedAssetKey || '').trim();
  const query = wordsOf([dayBrief?.source, dayBrief?.angle, dayBrief?.title, dayBrief?.direction].filter(Boolean).join(' '));
  const rows = [];
  for (const p of projects || []) {
    for (const a of p.assets || []) {
      if (!a?.key) continue;
      rows.push({
        key: a.key,
        project: p.name,
        summary: assetOneLiner(a),
        subjects: (a.vision?.subjects || []).slice(0, 4),
        preferred: preferred && a.key === preferred,
        score: scoreAsset(query, a) + (preferred && a.key === preferred ? 10 : 0),
      });
    }
  }
  rows.sort((a, b) => b.score - a.score || Number(b.preferred) - Number(a.preferred));
  return rows.slice(0, 6).map(({ key, project, summary, subjects, preferred }) => ({
    key, project, summary, subjects, preferred: Boolean(preferred),
  }));
}

function compileStrategyContext({
  brandDna,
  competitorInsights,
  projects,
  focusSummary,
  monthCalendar,
}) {
  const brand = compileBrandContext(brandDna);
  const competitor = compileCompetitorSignals(competitorInsights);
  return {
    brand,
    brandVoice: compileBrandVoice(brandDna),
    competitor,
    authority: compileAuthority(focusSummary),
    projects: compileProjectTruth(projects),
    calendar: compileCalendarSlots(monthCalendar),
    assetIndex: compileAssetIndex(projects),
    versions: {
      brand: brand.version,
      competitor: competitor.version,
    },
  };
}

function json(value) {
  return JSON.stringify(value);
}

module.exports = {
  compileStrategyContext,
  assetsForDay,
  recentCapturesOf,
  json,
  clip,
};

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

/** Source-truth text: keep the whole capture. Only cap pathological dumps. */
const ORIGINAL_CAPTURE_MAX = 20000;
function sourceText(value) {
  return clip(value, ORIGINAL_CAPTURE_MAX);
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
/** Idle gap that starts a new chat sitting. Captures saved closer than this
 *  belong to the latest session (one check-in / capture conversation). */
const SESSION_GAP_MS = 60 * 60 * 1000;

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
      summary: clip(s?.summary, 320),
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

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

function conversationCaptureOf(n) {
  const u = asUnderstanding(n.understanding);
  const mongoId = clip(n.id, 48);
  const whatHappened = clip(u.happened || u.whatHappened, 800);
  const captureSummary = clip(u.summary || u.captureSummary, 800);
  const verifiedFacts = Array.isArray(u.verifiedFacts)
    ? u.verifiedFacts.map((f) => clip(f, 400)).filter(Boolean).slice(0, 24)
    : [];
  return omitEmpty({
    id: mongoId,
    captureId: mongoId,
    project: n.project,
    originalCapture: sourceText(u.originalCapture || n.text),
    whatHappened,
    intent: clip(u.intent, 400),
    tension: clip(u.difficulty || u.tension, 400),
    action: clip(u.actionTaken || u.action, 400),
    outcome: clip(u.outcome, 400),
    captureSummary,
    summary: captureSummary,
    distinctSignals: signalsOf(u),
    sourceStoryId: clip(u.sourceStoryId, 64),
    segmentId: clip(u.segmentId, 64),
    relatedSegmentIds: Array.isArray(u.relatedSegmentIds)
      ? u.relatedSegmentIds.map((id) => clip(id, 64)).filter(Boolean).slice(0, 12)
      : [],
    relationships: relationshipsOf(u),
    verifiedFacts,
    openQuestions: Array.isArray(u.openQuestions)
      ? u.openQuestions.map((q) => clip(q, 220)).filter(Boolean).slice(0, 8)
      : [],
    unresolvedGap: clip(u.missingPiece || u.unresolvedGap, 320),
    knownLimitation: clip(u.knownLimitation, 320),
    observableDetails: Array.isArray(u.observableDetails)
      ? u.observableDetails.map((s) => clip(s, 220)).filter(Boolean).slice(0, 16)
      : [],
    visualLimitations: Array.isArray(u.visualLimitations)
      ? u.visualLimitations.map((s) => clip(s, 220)).filter(Boolean).slice(0, 12)
      : [],
    relevantAssetContext: Array.isArray(u.relevantAssetContext)
      ? u.relevantAssetContext.map((s) => clip(s, 220)).filter(Boolean).slice(0, 8)
      : [],
    attachedAssets: attachedAssetsOf(n),
    status: clip(u.captureStatus || u.status, 24),
    shown: n.shown || [],
  });
}

/** Newest captures first, across every project — never the full archive. */
function allCaptureRows(projects) {
  const all = [];
  for (const p of projects || []) {
    for (const n of p.notes || []) {
      const text = noteText(n);
      const assets = (n && n.assets) || [];
      const shown = assets.map((a) => assetOneLiner(a)).filter(Boolean);
      if (!text && !shown.length && !n.understanding) continue;
      all.push({
        id: n.id || '',
        project: p.name,
        text,
        createdAt: n.createdAt || null,
        sessionId: n.sessionId || '',
        shown: shown.slice(0, 4),
        assets,
        understanding: n.understanding || null,
      });
    }
  }
  return all;
}

function recentCapturesOf(projects, limit = RECENT_CAPTURES) {
  return allCaptureRows(projects)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

/** Pin planning to one conversation: explicit sessionId, else capture ids. */
function capturesForSource(projects, source = {}) {
  const all = allCaptureRows(projects);
  const sid = String(source.sessionId || '').trim();
  if (sid) {
    const hit = all.filter((r) => String(r.sessionId || '').trim() === sid);
    if (hit.length) {
      return hit.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
  }
  const ids = new Set(
    (Array.isArray(source.captureIds) ? source.captureIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  if (ids.size) {
    const hit = all.filter((r) => {
      const id = String(r.id || '');
      if (ids.has(id)) return true;
      for (const want of ids) {
        if (id === want || id.startsWith(`${want}:`)) return true;
      }
      return false;
    });
    if (hit.length) {
      return hit.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
  }
  return null;
}

function sessionRowsOf(projects, source = {}) {
  const pinned = capturesForSource(projects, source);
  if (pinned && pinned.length) return pinned;
  return conversationSessionOf(recentCapturesOf(projects, 10));
}

/** Latest chat sitting only. Prefer an explicit sessionId (one capture or
 *  check-in conversation). Fall back to the idle-gap heuristic for older rows. */
function conversationSessionOf(rows) {
  if (!rows.length) return [];
  const sid = String(rows[0].sessionId || '').trim();
  if (sid) return rows.filter((r) => String(r.sessionId || '').trim() === sid);
  const newestAt = new Date(rows[0].createdAt || 0).getTime();
  if (!newestAt) return rows.slice(0, 1);
  const session = [rows[0]];
  let prevAt = newestAt;
  for (let i = 1; i < rows.length; i += 1) {
    const t = new Date(rows[i].createdAt || 0).getTime();
    if (!t || prevAt - t > SESSION_GAP_MS) break;
    session.push(rows[i]);
    prevAt = t;
  }
  return session;
}

function compileProjectTruth(projects, source = {}) {
  const session = sessionRowsOf(projects, source);
  const conversationCaptures = session
    .map(conversationCaptureOf)
    .filter((c) => c.originalCapture || c.whatHappened || c.captureSummary);
  const out = { conversationCaptures };
  if (source.sessionId || (source.captureIds && source.captureIds.length)) {
    out.planFromSession = true;
  }
  if (!conversationCaptures.length && session[0]) {
    out.latestCapture = {
      project: session[0].project,
      text: session[0].text,
      shown: session[0].shown,
      attachedAssets: attachedAssetsOf(session[0]),
      planFromThis: true,
    };
  }
  return out;
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
  const summary = clip(a?.vision?.summary, 180);
  if (summary) return summary;
  return clip(a?.vision?.description || a?.note, 180);
}

function assetContextRow(a) {
  const v = a?.vision || {};
  const photoNote = String(a?.note || '').trim();
  return omitEmpty({
    key: String(a?.key || '').trim(),
    summary: sourceText(v.summary || v.description || photoNote),
    subjects: (v.subjects || []).map((s) => clip(s, 40)).filter(Boolean).slice(0, 6),
    tags: (v.tags || []).map((s) => clip(s, 28)).filter(Boolean).slice(0, 6),
    mood: clip(v.mood, 48),
    textInImage: sourceText(v.text),
  });
}

function attachedAssetsOf(n) {
  return (n?.assets || [])
    .map(assetContextRow)
    .filter((row) => row.key || row.summary || (row.subjects && row.subjects.length))
    .slice(0, 8);
}

function sessionQueryWords(session) {
  const text = (session || []).map((c) => {
    const u = asUnderstanding(c.understanding);
    return [
      noteText(c),
      u.happened || u.whatHappened,
      u.summary || u.captureSummary,
      u.intent,
    ].filter(Boolean).join(' ');
  }).join(' ');
  return wordsOf(text);
}

/** Visual record for the Strategist: conversation attachments plus the same
 *  project's library photos, including real keys so Strategy can allocate
 *  relevant files onto briefs. Later agents decide whether they appear. */
function compileAssetContext(projects, source = {}) {
  const session = sessionRowsOf(projects, source);
  const query = sessionQueryWords(session);
  const sessionProjects = new Set(session.map((c) => c.project).filter(Boolean));
  const conversationKeys = new Set();
  const conversationAssets = session.map((c) => {
    (c.assets || []).forEach((a) => { if (a?.key) conversationKeys.add(a.key); });
    return omitEmpty({
      captureId: clip(c.id, 48),
      project: c.project,
      assets: attachedAssetsOf(c),
    });
  }).filter((row) => (row.assets || []).length);

  const projectAssets = [];
  const sourceProjects = (projects || []).filter((p) => (
    !sessionProjects.size || sessionProjects.has(p.name)
  ));
  for (const p of sourceProjects) {
    const ranked = (p.assets || [])
      .filter((a) => a && !conversationKeys.has(a.key))
      .map((a) => ({ a, score: scoreAsset(query, a) }))
      .sort((x, y) => y.score - x.score);
    const assets = ranked
      .map(({ a }) => assetContextRow(a))
      .filter((row) => row.key || row.summary || (row.subjects && row.subjects.length))
      .slice(0, 12);
    if (assets.length) projectAssets.push({ project: p.name, assets });
  }

  return omitEmpty({ conversationAssets, projectAssets });
}

function compileAssetIndex(projects, assetContext) {
  const ctx = assetContext || compileAssetContext(projects);
  const rows = [];
  (ctx.conversationAssets || []).forEach((c) => {
    (c.assets || []).forEach((a) => {
      if (a.summary) rows.push({ project: c.project, summary: a.summary, source: 'conversation' });
    });
  });
  (ctx.projectAssets || []).forEach((p) => {
    (p.assets || []).forEach((a) => {
      if (a.summary) rows.push({ project: p.project, summary: a.summary, source: 'project' });
    });
  });
  return rows.slice(0, 24);
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
function captureAssetKeys(projects, captureId) {
  const id = String(captureId || '').trim();
  if (!id) return new Set();
  const keys = new Set();
  for (const p of projects || []) {
    for (const n of p.notes || []) {
      const match = n.id === id || String(n.understanding?.captureId || '') === id;
      if (!match) continue;
      (n.assets || []).forEach((a) => { if (a?.key) keys.add(a.key); });
    }
  }
  return keys;
}

function allocatedAssetsOf(value) {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = String(row && typeof row === 'object' ? row.key : row || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const source = String(row && typeof row === 'object' ? row.source : '').trim().toLowerCase();
    out.push(omitEmpty({
      key,
      source: source === 'conversation' || source === 'project' ? source : '',
      why: clip(row && typeof row === 'object' ? row.why : '', 160),
    }));
  }
  return out.slice(0, 4);
}

function allocatedKeysOf(dayBrief) {
  return allocatedAssetsOf([
    ...(Array.isArray(dayBrief?.allocatedAssets) ? dayBrief.allocatedAssets : []),
    ...(Array.isArray(dayBrief?.allocatedAssetKeys) ? dayBrief.allocatedAssetKeys : []),
    dayBrief?.suggestedAssetKey,
  ]).map((a) => a.key);
}

function knownAssetIndexOf(projects, assetContext) {
  const keys = new Set();
  const conversationKeys = new Set();
  const conversationByCapture = new Map();
  const summaries = new Map();
  const remember = (key, summary) => {
    if (!key) return;
    keys.add(key);
    if (summary && !summaries.has(key)) summaries.set(key, summary);
  };
  const addConversation = (captureId, key, summary) => {
    remember(key, summary);
    if (!key) return;
    conversationKeys.add(key);
    const id = String(captureId || '').trim();
    if (!id) return;
    const set = conversationByCapture.get(id) || new Set();
    set.add(key);
    conversationByCapture.set(id, set);
  };

  (assetContext?.conversationAssets || []).forEach((c) => {
    (c.assets || []).forEach((a) => addConversation(c.captureId, a?.key, a?.summary));
  });
  (assetContext?.projectAssets || []).forEach((p) => {
    (p.assets || []).forEach((a) => remember(a?.key, a?.summary));
  });
  for (const p of projects || []) {
    (p.assets || []).forEach((a) => remember(a?.key, assetOneLiner(a)));
    (p.notes || []).forEach((n) => {
      (n.assets || []).forEach((a) => remember(a?.key, assetOneLiner(a)));
    });
  }
  return { keys, conversationKeys, conversationByCapture, summaries };
}

function conversationKeysForBrief(known, brief, capture) {
  const ids = [
    brief?.captureId,
    brief?.sourceStoryId,
    capture?.id,
    capture?.captureId,
    capture?.sourceStoryId,
  ].map((v) => String(v || '').trim()).filter(Boolean);
  const set = new Set();
  ids.forEach((id) => {
    known.conversationByCapture.forEach((keys, captureId) => {
      if (captureId === id || captureId.startsWith(`${id}:`) || id.startsWith(`${captureId}:`)) {
        keys.forEach((key) => set.add(key));
      }
    });
  });
  return set;
}

function sanitizeAllocatedAssets(raw, brief, capture, known) {
  if (!known) return allocatedAssetsOf(raw);
  const allowedConversation = conversationKeysForBrief(known, brief, capture);
  return allocatedAssetsOf(raw).filter((a) => {
    if (!known.keys.has(a.key)) return false;
    if (known.conversationKeys.has(a.key) && allowedConversation.size) {
      return allowedConversation.has(a.key);
    }
    return true;
  });
}

function applyAssetAllocation(brief, capture, known) {
  let allocated = sanitizeAllocatedAssets(brief?.allocatedAssets, brief, capture, known);
  if (!allocated.length && capture) {
    allocated = sanitizeAllocatedAssets(
      (capture.attachedAssets || []).map((a) => ({
        key: a.key,
        source: 'conversation',
        why: a.summary || '',
      })),
      { ...brief, captureId: brief.captureId || capture.id || capture.captureId },
      capture,
      known,
    );
  }
  const fromAllocated = allocated
    .map((a) => a.why || known?.summaries?.get(a.key) || '')
    .filter(Boolean);
  return {
    allocatedAssets: allocated,
    suggestedAssetKey: allocated[0]?.key || '',
    relevantAssetContext: (brief.relevantAssetContext && brief.relevantAssetContext.length)
      ? brief.relevantAssetContext
      : fromAllocated.slice(0, 8),
  };
}

function projectNameForBrief(projects, dayBrief) {
  const named = String(dayBrief?.project || '').trim();
  if (named) return named;
  const id = String(dayBrief?.captureId || '').trim();
  if (!id) return '';
  for (const p of projects || []) {
    for (const n of p.notes || []) {
      const match = n.id === id
        || String(n.understanding?.captureId || '') === id
        || (id && String(n.id || '').startsWith(`${id}:`));
      if (match) return p.name;
    }
  }
  return '';
}

function assetsForDay(projects, dayBrief) {
  const allocated = allocatedKeysOf(dayBrief);
  const allocatedSet = new Set(allocated);
  const preferred = allocated[0] || String(dayBrief?.suggestedAssetKey || '').trim();
  const fromCapture = captureAssetKeys(projects, dayBrief?.captureId);
  const briefProject = projectNameForBrief(projects, dayBrief);
  const query = wordsOf([
    dayBrief?.source,
    dayBrief?.angle,
    dayBrief?.title,
    dayBrief?.direction,
    dayBrief?.project,
    ...(Array.isArray(dayBrief?.allocatedAssets) ? dayBrief.allocatedAssets.map((a) => a?.why) : []),
  ].filter(Boolean).join(' '));
  const rows = [];
  const seen = new Set();
  const push = (a, projectName) => {
    if (!a?.key || seen.has(a.key)) return;
    seen.add(a.key);
    const captureHit = fromCapture.has(a.key);
    const allocatedHit = allocatedSet.has(a.key);
    rows.push({
      key: a.key,
      project: projectName,
      summary: assetOneLiner(a),
      subjects: (a.vision?.subjects || []).slice(0, 4),
      preferred: Boolean(allocatedHit || (preferred && a.key === preferred) || captureHit),
      allocated: allocatedHit,
      score: scoreAsset(query, a)
        + (allocatedHit ? 20 : 0)
        + (preferred && a.key === preferred ? 5 : 0)
        + (captureHit ? 8 : 0),
    });
  };
  for (const p of projects || []) {
    for (const n of p.notes || []) {
      const match = dayBrief?.captureId
        && (n.id === dayBrief.captureId || String(n.understanding?.captureId || '') === dayBrief.captureId);
      if (match) (n.assets || []).forEach((a) => push(a, p.name));
    }
  }
  for (const p of projects || []) {
    if (briefProject && p.name !== briefProject) continue;
    for (const a of p.assets || []) push(a, p.name);
  }
  rows.sort((a, b) => b.score - a.score || Number(b.preferred) - Number(a.preferred));
  const picked = [];
  const seenPick = new Set();
  allocated.forEach((key) => {
    const hit = rows.find((r) => r.key === key);
    if (hit && !seenPick.has(key)) {
      picked.push({ ...hit, preferred: true, allocated: true });
      seenPick.add(key);
    }
  });
  for (const r of rows) {
    if (picked.length >= 6) break;
    if (seenPick.has(r.key)) continue;
    picked.push({ ...r, allocated: Boolean(r.allocated) });
    seenPick.add(r.key);
  }
  return picked.map(({ key, project, summary, subjects, preferred, allocated }) => ({
    key, project, summary, subjects, preferred: Boolean(preferred), allocated: Boolean(allocated),
  }));
}

function compileStrategyContext({
  brandDna,
  competitorInsights,
  projects,
  focusSummary,
  monthCalendar,
  sessionId = '',
  captureIds = [],
}) {
  const brand = compileBrandContext(brandDna);
  const competitor = compileCompetitorSignals(competitorInsights);
  const planSource = { sessionId, captureIds };
  const assetContext = compileAssetContext(projects, planSource);
  return {
    brand,
    brandVoice: compileBrandVoice(brandDna),
    competitor,
    authority: compileAuthority(focusSummary),
    projects: compileProjectTruth(projects, planSource),
    calendar: compileCalendarSlots(monthCalendar),
    assetContext,
    assetIndex: compileAssetIndex(projects, assetContext),
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
  allocatedAssetsOf,
  applyAssetAllocation,
  knownAssetIndexOf,
  recentCapturesOf,
  conversationSessionOf,
  capturesForSource,
  sessionRowsOf,
  json,
  clip,
};

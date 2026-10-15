/**
 * Business memory display translation. The stored Brand DNA, gaps and Brand
 * Voice stay in the language they were written in (the planner reads them);
 * when Settings › Language is not English, the page gets a translated copy.
 * One model call per content change, cached on the report per language.
 */

const crypto = require('crypto');
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const { completeText, conversationModel } = require('./llmComplete');
const { LANGUAGES } = require('../utils/appLocale');

const GAP_FIELDS = ['missing', 'why', 'improves', 'prompt', 'question'];

function translateModel() {
  return process.env.MEMORY_TRANSLATE_MODEL || conversationModel();
}

/** Flatten every model-written string in the payload to { id: text }. */
function stringsOf(payload) {
  const out = {};
  const put = (id, value) => {
    const text = String(value || '').trim();
    if (/[A-Za-z]/.test(text)) out[id] = text;
  };
  (payload.sections || []).forEach((s) => put(`s.${s.key}`, s.value));
  (payload.gaps || []).forEach((g, i) => GAP_FIELDS.forEach((f) => put(`g.${i}.${f}`, g[f])));
  const voice = payload.brandVoice;
  if (voice && typeof voice === 'object') {
    for (const [axis, value] of Object.entries(voice)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      put(`v.${axis}.s`, value.summary);
      (Array.isArray(value.labels) ? value.labels : []).forEach((l, j) => put(`v.${axis}.l.${j}`, l));
    }
  }
  return out;
}

function applyStrings(payload, map) {
  const pick = (id, original) => (typeof map[id] === 'string' && map[id].trim() ? map[id] : original);
  const next = { ...payload };
  next.sections = (payload.sections || []).map((s) => ({ ...s, value: pick(`s.${s.key}`, s.value) }));
  next.gaps = (payload.gaps || []).map((g, i) => {
    const row = { ...g };
    GAP_FIELDS.forEach((f) => { row[f] = pick(`g.${i}.${f}`, g[f]); });
    return row;
  });
  if (payload.brandVoice && typeof payload.brandVoice === 'object') {
    const voice = { ...payload.brandVoice };
    for (const [axis, value] of Object.entries(voice)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      voice[axis] = {
        ...value,
        summary: pick(`v.${axis}.s`, value.summary),
        labels: Array.isArray(value.labels) ? value.labels.map((l, j) => pick(`v.${axis}.l.${j}`, l)) : value.labels,
      };
    }
    next.brandVoice = voice;
  }
  return next;
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in translation response');
  return JSON.parse(raw.slice(start, end + 1));
}

const SYSTEM = [
  'You translate the text of a small business\'s marketing memory for display in an app.',
  'You receive a JSON object of id → text. Return ONLY a JSON object with exactly the same ids, each value translated into the target language.',
  'Keep the meaning, tone and second-person voice. Keep brand names, people\'s names, place names, @handles, hashtags, numbers and quoted post text unchanged.',
  'Text that is already in the target language is returned as is. Do not add, drop or merge ids.',
].join(' ');

/**
 * Returns the payload with its memory text in `locale`. English (or an empty
 * payload) is returned untouched; any failure falls back to the original.
 */
async function localizeBrandDnaPayload(report, payload, locale) {
  if (!locale || locale === 'en' || !LANGUAGES[locale] || !report?._id) return payload;
  const strings = stringsOf(payload);
  const ids = Object.keys(strings);
  if (!ids.length) return payload;

  const hash = crypto.createHash('sha1').update(`${locale}\n${JSON.stringify(strings)}`).digest('hex');
  const cached = report.memoryTranslations?.[locale];
  if (cached?.hash === hash && cached.strings) return applyStrings(payload, cached.strings);

  try {
    const res = await completeText({
      model: translateModel(),
      system: SYSTEM,
      user: `TARGET LANGUAGE: ${LANGUAGES[locale]}\n\n${JSON.stringify(strings, null, 2)}`,
      maxTokens: 6000,
      kind: 'conversation',
      reasoningEffort: 'low',
      timeoutMs: 60000,
    });
    const parsed = parseJsonObject(res.text);
    const translated = {};
    for (const id of ids) if (typeof parsed[id] === 'string') translated[id] = parsed[id];
    BrandAnalysisReport.updateOne(
      { _id: report._id },
      { $set: { [`memoryTranslations.${locale}`]: { hash, strings: translated, at: new Date() } } },
    ).catch((err) => console.warn('[memoryTranslate] cache save failed:', err.message));
    return applyStrings(payload, translated);
  } catch (err) {
    console.warn(`[memoryTranslate] ${locale} translation failed — showing original:`, err.message);
    return payload;
  }
}

module.exports = { localizeBrandDnaPayload };

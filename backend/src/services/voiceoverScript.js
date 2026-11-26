/*
 * Capture › Reel › "Include voiceover" (bauhly-v3 VoicePrep): the script the
 * studio records, part by part, before the Reel is cut. One model call
 * (prompts/reel-voiceover-script.md) over the capture's own words, its
 * attachments' descriptions and the brand voice → 2–4 parts
 * { ask, say, seconds:[min,max], assetKeys }. The recordings come back with
 * POST /capture-reels (voiceover.takes) and become the Reel's voice track
 * (captureReelAgent › studioVoiceOf).
 */
const fs = require('fs');
const path = require('path');
const Project = require('../models/Project');
const { completeText, splitPromptTemplate } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { extractJson, estimatePlanCostUsd } = require('./weeklyPlan');
const { loadBrandDna } = require('./planInputs');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'reel-voiceover-script.md');
const str = (v, max = 2000) => String(v == null ? '' : v).trim().slice(0, max);

function materialOf(capture) {
  let n = 0;
  return (capture.attachments || [])
    .filter((a) => a?.key && a.reelTake !== 'say' && (a.type === 'image' || a.type === 'video'))
    .map((a) => {
      n += 1;
      const an = a.analysis && a.analysis.status === 'done' ? a.analysis : {};
      return {
        id: `m${n}`,
        key: a.key,
        kind: a.type,
        shows: str(an.summary || an.description, 300),
        ...(a.type === 'video' && an.transcript ? { saidInClip: str(an.transcript, 400) } : {}),
        ...(a.type === 'video' && an.durationSec ? { seconds: Math.round(an.durationSec) } : {}),
      };
    });
}

function captureOf(capture) {
  const u = capture.understanding || {};
  return {
    words: str(capture.text, 3000),
    summary: str(capture.sessionSummary || u.captureSummary, 800),
    facts: (u.verifiedFacts || []).map((f) => str(f?.fact || f, 200)).filter(Boolean).slice(0, 12),
    answers: (u.clarificationAnswers || []).map((a) => ({ q: str(a?.question, 200), a: str(a?.answer, 400) })).filter((a) => a.a).slice(0, 6),
  };
}

function normalize(parsed, material) {
  const byId = new Map(material.map((m) => [m.id, m.key]));
  const used = new Set();
  const parts = (Array.isArray(parsed?.parts) ? parsed.parts : [])
    .map((p) => {
      const say = str(p?.say, 600);
      if (!say) return null;
      const secs = Array.isArray(p?.seconds) ? p.seconds.map(Number).filter((x) => x > 0) : [];
      const words = say.split(/\s+/).length;
      const guess = Math.max(3, Math.round(words / 2.5));
      const assetKeys = (Array.isArray(p?.assets) ? p.assets : [])
        .map((id) => byId.get(String(id))).filter((k) => k && !used.has(k)).slice(0, 3);
      assetKeys.forEach((k) => used.add(k));
      return {
        ask: str(p?.ask, 140),
        say,
        seconds: secs.length >= 2 ? [Math.round(secs[0]), Math.round(secs[1])] : [guess, guess + 3],
        assetKeys,
      };
    })
    .filter(Boolean)
    .slice(0, 4);
  if (!parts.length) throw new Error('The script came back empty.');
  return parts;
}

async function writeVoiceoverScript({ userId, projectId, captureId }) {
  const project = await Project.findOne({ _id: projectId, user: userId });
  const capture = project?.captures?.id(captureId);
  if (!capture) {
    const err = new Error('Capture not found');
    err.status = 404;
    throw err;
  }
  const material = materialOf(capture);
  // talking clips: is their own sound good enough to play in the Reel? (the same check the Reel director
  // uses — captureReelAgent speechQualityOf). Where it is, the script writes around what they say.
  await Promise.all(material.filter((m) => m.kind === 'video' && String(m.saidInClip || '').split(/\s+/).length >= 6).map(async (m) => {
    try {
      const reel = require('./captureReelAgent');
      m.onCameraSound = reel.speechQualityOf(await reel.clipWords(m.key)).quality;
    } catch (err) {
      console.warn('[voiceoverScript] on-camera sound check failed', m.key, err.message);
    }
  }));
  const dna = project.instagramUsername ? await loadBrandDna(userId, project.instagramUsername).catch(() => null) : null;
  const brand = dna ? {
    whatYouOffer: dna.whatYouOffer, whoYouHelp: dna.whoYouHelp, howYouSound: dna.howYouSound,
    voice: dna.brandVoice && typeof dna.brandVoice === 'object' ? dna.brandVoice : undefined, neverDo: dna.neverDo,
  } : {};
  const { system, userTemplate } = splitPromptTemplate(fs.readFileSync(PROMPT_FILE, 'utf8'));
  const user = userTemplate
    .replace('{{CAPTURE_JSON}}', JSON.stringify(captureOf(capture), null, 2))
    .replace('{{MATERIAL_JSON}}', JSON.stringify(material.map(({ key, ...m }) => m), null, 2))
    .replace('{{BRAND_JSON}}', JSON.stringify(brand, null, 2));
  const llm = resolvePlanAgentLlm('captureReel');
  const started = Date.now();
  const res = await completeText({ model: llm.model, system, user, maxTokens: 4000, kind: 'captureReel', timeoutMs: 90000 });
  const parts = normalize(extractJson(res.text || ''), material);
  const usage = res.usage || {};
  const debug = {
    source: 'Reel voiceover script',
    model: res.model || llm.model,
    prompt: `${system}\n\n---\n\n${user}`,
    output: res.text || '',
    elapsedMs: Date.now() - started,
    costUsd: estimatePlanCostUsd(res.model || llm.model, Number(usage.input_tokens) || 0, Number(usage.output_tokens) || 0, Number(usage.cached_tokens) || 0),
  };
  return { parts, debug };
}

module.exports = { writeVoiceoverScript };

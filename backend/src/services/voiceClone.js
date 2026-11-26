/*
 * Capture › Reel › Include voiceover › "Use my cloned voice".
 *
 * ElevenLabs Instant Voice Cloning: the studio reads a short passage (or uploads
 * a recording of themselves), the samples go to ElevenLabs once and come back as
 * a voice id kept on the user (User.voiceClone). Each script part is then read
 * in that voice and saved to S3 under the user's projects/ prefix, so it is a
 * take like any recorded one — the reel pipeline (captureReelAgent studioVoiceOf)
 * joins, levels and word-times it with no changes.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { execFile } = require('child_process');
const User = require('../models/User');
const { getObjectBytes, uploadBytes, getMediaUrl } = require('./s3Client');

const run = promisify(execFile);
const API = 'https://api.elevenlabs.io/v1';
const ffmpegPath = () => process.env.FFMPEG_PATH || require('ffmpeg-static');

class VoiceCloneError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const apiKey = () => String(process.env.ELEVENLABS_API_KEY || '').trim();
const isConfigured = () => Boolean(apiKey());

async function eleven(pathname, init = {}) {
  if (!isConfigured()) throw new VoiceCloneError('Voice cloning is not set up on this server yet.', 503);
  const res = await fetch(`${API}${pathname}`, { ...init, headers: { 'xi-api-key': apiKey(), ...(init.headers || {}) } });
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.detail?.message || j?.detail?.status || (typeof j?.detail === 'string' ? j.detail : ''); } catch { /* not json */ }
    console.warn(`[voiceClone] ElevenLabs ${init.method || 'GET'} ${pathname} → ${res.status} ${detail}`);
    throw new VoiceCloneError(detail && res.status < 500 ? `ElevenLabs: ${detail}` : 'ElevenLabs could not do that just now — try again.', res.status === 401 ? 503 : 502);
  }
  return res;
}

// a recording (webm/opus, m4a, a phone video…) → a clean clone sample. WAV, so
// nothing is lost to a second lossy encode; only a rumble cut, the silence at
// the ends trimmed and one gentle level. No denoise: a clone learns whatever is
// in the sample, and noise reduction (the browser's, or ElevenLabs'
// remove_background_noise) leaves the metallic, "phone call" texture that makes
// a cloned voice sound robotic.
async function toSample(buffer) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vclone-'));
  try {
    const src = path.join(dir, 'in');
    const out = path.join(dir, 'out.wav');
    await fs.promises.writeFile(src, buffer);
    await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn',
      '-af', 'highpass=f=60,silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-18:TP=-2:LRA=11',
      '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', out], { timeout: 180000 });
    return await fs.promises.readFile(out);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function durationOf(buffer) {
  // ffmpeg prints "Duration: 00:00:07.34" on stderr for an input with no output
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vclone-d-'));
  try {
    const src = path.join(dir, 'a.audio');
    await fs.promises.writeFile(src, buffer);
    const { stderr } = await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-i', src, '-f', 'null', '-'], { timeout: 60000 })
      .catch((e) => ({ stderr: e.stderr || '' }));
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
    let last = null; let x;
    while ((x = m.exec(stderr))) last = x;
    if (!last) return 0;
    return Math.round(((Number(last[1]) * 3600) + (Number(last[2]) * 60) + Number(last[3])) * 1000);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function status(userId) {
  const u = await User.findById(userId).select('voiceClone').lean();
  const vc = u?.voiceClone || {};
  return { configured: isConfigured(), cloned: Boolean(vc.voiceId), createdAt: vc.createdAt || null };
}

// samples: S3 keys the browser uploaded (projects/<userId>/…), 1–5 of them, ~1 min in all is plenty
async function cloneVoice(userId, { keys = [], consent = false } = {}) {
  if (!consent) throw new VoiceCloneError('Please confirm this is your own voice first.');
  const prefix = `projects/${userId}/`;
  const sampleKeys = (Array.isArray(keys) ? keys : []).filter((k) => typeof k === 'string' && k.startsWith(prefix) && k.length < 300).slice(0, 5);
  if (!sampleKeys.length) throw new VoiceCloneError('Record or upload a sample of your voice first.');
  const user = await User.findById(userId).select('name voiceClone');
  if (!user) throw new VoiceCloneError('Account not found.', 404);

  const form = new FormData();
  form.append('name', `Bauhly · ${String(user.name || 'studio').slice(0, 40)} · ${String(userId).slice(-6)}`);
  // off by default: the samples are recorded raw and only lightly cleaned (toSample)
  form.append('remove_background_noise', process.env.ELEVENLABS_CLONE_DENOISE === '1' ? 'true' : 'false');
  form.append('description', 'Studio voice for Instagram Reel voiceovers (Bauhly).');
  let total = 0;
  for (let i = 0; i < sampleKeys.length; i += 1) {
    const { buffer } = await getObjectBytes(sampleKeys[i]);
    const wav = await toSample(buffer);
    total += await durationOf(wav);
    form.append('files', new Blob([wav], { type: 'audio/wav' }), `sample-${i + 1}.wav`);
  }
  if (total && total < 25000) throw new VoiceCloneError('That sample is too short — talk for at least 30 seconds (one to two minutes is best).');

  const res = await eleven('/voices/add', { method: 'POST', body: form });
  const { voice_id: voiceId } = await res.json();
  if (!voiceId) throw new VoiceCloneError('ElevenLabs did not return a voice — try again.', 502);

  // a re-clone replaces the old voice (one per person)
  const old = user.voiceClone?.voiceId;
  user.voiceClone = { provider: 'elevenlabs', voiceId, sampleKeys, consentAt: new Date(), createdAt: new Date() };
  await user.save();
  if (old && old !== voiceId) eleven(`/voices/${encodeURIComponent(old)}`, { method: 'DELETE' }).catch(() => {});
  return { cloned: true, createdAt: user.voiceClone.createdAt, sampleMs: total };
}

// eleven_v3 is ElevenLabs' most expressive model: it performs audio tags
// ([warmly], [short pause]…) and reads punctuation as rhythm, which is what
// lets the delivery follow the story. v2 is the fallback when the account
// can't use v3: tags stripped, the directed punctuation kept, and request
// stitching (previous_text / next_text) so the parts flow as one voiceover.
const TTS_MODEL = () => process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3';
const FALLBACK_MODEL = 'eleven_multilingual_v2';
const isV3 = (m) => /v3/i.test(m);
const clean = (t, max = 1200) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, max);
const stripTags = (t) => clean(String(t || '').replace(/\[[^\]\n]{1,40}\]/g, ' '));
// the spoken words only, to check the director kept them all, in order
const wordsOf = (t) => stripTags(t).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);

const DELIVERY_PROMPT = path.join(__dirname, '..', '..', 'prompts', 'voiceover-delivery.md');
// Voice director: marks one part up with audio tags + rhythm punctuation for
// where it sits in the story (hook / reason / result / next step). Never trusted
// with the words — if anything spoken changed, the plain part is read instead.
async function directDelivery(script, partIndex, userId) {
  const text = script[partIndex];
  if (process.env.VOICE_DELIVERY_DIRECTOR === 'off') return { text, tone: '' };
  try {
    const { completeText, splitPromptTemplate, resolvePlanAgentLlm } = require('./llmComplete');
    const { extractJson } = require('./weeklyPlan');
    const { system, userTemplate } = splitPromptTemplate(fs.readFileSync(DELIVERY_PROMPT, 'utf8'));
    const user = userTemplate
      .replace('{{SCRIPT_JSON}}', JSON.stringify(script.map((say, i) => ({ part: i, say })), null, 1))
      .replace('{{PART_INDEX}}', String(partIndex))
      .replace('{{PART_TEXT}}', text);
    const llm = resolvePlanAgentLlm('captureReel');
    const t0 = Date.now();
    const res = await completeText({ model: process.env.VOICE_DELIVERY_MODEL || llm.model, system, user, maxTokens: 1200, kind: 'captureReel', timeoutMs: 30000 });
    const out = extractJson(res.text || '') || {};
    const directed = clean(out.text, 1600);
    const same = directed && wordsOf(directed).join(' ') === wordsOf(text).join(' ');
    console.log(`[voiceClone] ${userId} part ${partIndex} direction (${Date.now() - t0} ms, ${same ? 'kept' : 'words changed — plain read'}): ${directed}`);
    return same ? { text: directed, tone: clean(out.tone, 60) } : { text, tone: '' };
  } catch (err) {
    console.warn(`[voiceClone] delivery direction failed — plain read: ${err.message}`);
    return { text, tone: '' };
  }
}

async function tts(voiceId, model, { text, prevText, nextText }) {
  const v3 = isV3(model);
  return eleven(`/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: v3 ? text : stripTags(text),
      model_id: model,
      // v3 performs from the tags and doesn't take stitching; v2 needs the neighbours to flow
      ...(!v3 && prevText ? { previous_text: prevText } : {}),
      ...(!v3 && nextText ? { next_text: nextText } : {}),
      voice_settings: v3
        // "Natural" (0.5): follows the tags but stays close to the person's own voice
        ? { stability: 0.5, similarity_boost: 0.9, use_speaker_boost: true }
        // likeness first; some style so it doesn't flatten; normal speed (slowing it down sounds synthetic)
        : { stability: 0.4, similarity_boost: 0.9, style: 0.3, use_speaker_boost: true, speed: 1 },
    }),
  });
}

// one script part read in the cloned voice → an mp3 take in S3.
// script: every part's words in order (the director reads the whole story);
// older clients send only text (+ prevText / nextText).
async function speak(userId, { text = '', part = 0, script = null, prevText = '', nextText = '' } = {}) {
  const idx = Math.max(0, Math.min(11, Math.round(Number(part) || 0)));
  const all = Array.isArray(script) && script.length ? script.slice(0, 12).map((x) => clean(x, 1200)) : null;
  const words = clean(text) || (all ? all[idx] : '');
  if (!words) throw new VoiceCloneError('Nothing to read.');
  const parts = all && all[idx] === words ? all : [clean(prevText, 600), words, clean(nextText, 600)].filter(Boolean);
  const at = parts.indexOf(words);
  const u = await User.findById(userId).select('voiceClone').lean();
  const voiceId = u?.voiceClone?.voiceId;
  if (!voiceId) throw new VoiceCloneError('Clone your voice first.', 409);

  const t0 = Date.now();
  const directed = await directDelivery(parts, at, userId);
  const around = { prevText: clean(parts[at - 1], 600), nextText: clean(parts[at + 1], 600) };
  let model = TTS_MODEL();
  let res;
  try {
    res = await tts(voiceId, model, { text: directed.text, ...around });
  } catch (err) {
    // v3 not on this plan / not for this voice → the v2 read, still directed
    if (!isV3(model) || !(err instanceof VoiceCloneError) || err.status === 503) throw err;
    console.warn(`[voiceClone] ${model} refused (${err.message}) — falling back to ${FALLBACK_MODEL}`);
    model = FALLBACK_MODEL;
    res = await tts(voiceId, model, { text: directed.text, ...around });
  }
  const mp3 = Buffer.from(await res.arrayBuffer());
  if (!mp3.length) throw new VoiceCloneError('ElevenLabs returned no audio — try again.', 502);
  const key = `projects/${userId}/voiceover/clone-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-p${idx}.mp3`;
  await uploadBytes(key, mp3, 'audio/mpeg', { immutable: true });
  const ms = await durationOf(mp3).catch(() => 0);
  console.log(`[voiceClone] ${userId} part ${idx}: ${model}, ${words.length} chars → ${ms} ms in ${Date.now() - t0} ms`);
  return { key, ms, url: await getMediaUrl(key), tone: directed.tone, model };
}

async function removeVoice(userId) {
  const user = await User.findById(userId).select('voiceClone');
  const voiceId = user?.voiceClone?.voiceId;
  if (!user) return { cloned: false };
  user.voiceClone = { provider: '', voiceId: '', sampleKeys: [], consentAt: null, createdAt: null };
  await user.save();
  if (voiceId && isConfigured()) await eleven(`/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE' }).catch(() => {});
  return { cloned: false };
}

module.exports = { status, cloneVoice, speak, removeVoice, VoiceCloneError, isConfigured, wordsOf, stripTags };

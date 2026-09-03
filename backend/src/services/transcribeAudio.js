/*
 * Voice-note transcription for Capture. The conversation keeps the words, not
 * the audio — this turns a short recording into text the understander can read.
 *
 * Default model is gpt-transcribe (OpenAI's current file-transcription model).
 * whisper-1 remains available via OPENAI_TRANSCRIBE_MODEL when someone needs
 * timestamps or a known-good fallback.
 */

const { toFile } = require('openai');
const getOpenAIClient = require('./openaiClient');
const { completeText, conversationModel } = require('./llmComplete');

const DEFAULT_PROMPT = [
  'A studio owner recording a voice note about their work, projects, clients,',
  'materials, and Instagram content. Transcribe exactly what was said.',
  'Keep names, places, materials, and product terms as spoken.',
  'Use natural punctuation. Never invent words.',
  'If a single word is unintelligible, write [?]. Never write [unclear], [inaudible], or any other commentary.',
].join(' ');

function transcribeModel() {
  return process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe';
}

function filenameFor(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('mp4') || ct.includes('m4a')) return 'note.m4a';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'note.mp3';
  if (ct.includes('wav')) return 'note.wav';
  if (ct.includes('ogg')) return 'note.ogg';
  return 'note.webm';
}

function modelKind(model) {
  const id = String(model || '');
  if (id === 'whisper-1' || id.startsWith('whisper-')) return 'whisper';
  if (id === 'gpt-transcribe' || id.startsWith('gpt-transcribe')) return 'gpt-transcribe';
  if (id.includes('gpt-4o-transcribe')) return 'gpt-4o-transcribe';
  return 'gpt-transcribe';
}

function parseLanguages() {
  const raw = process.env.OPENAI_TRANSCRIBE_LANGUAGES;
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function sanitizeKeyword(value) {
  const text = String(value || '').replace(/[<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 80) return '';
  return text;
}

function sanitizeKeywords(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const keyword = sanitizeKeyword(item);
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= 24) break;
  }
  return out;
}

function clip(text, max) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function normalizeTranscript(text) {
  return String(text || '')
    .replace(/\[(?:unclear|inaudible|unintelligible)[^\]]*\]/gi, '[?]')
    .replace(/\((?:unclear|inaudible|unintelligible)\)/gi, '[?]')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripModelWrapper(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:\w+)?\n?/, '').replace(/\n?```$/, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

function correctModel() {
  return process.env.OPENAI_TRANSCRIPT_CORRECT_MODEL || conversationModel();
}

const CORRECT_SYSTEM = [
  'Correct this voice-note transcript.',
  'Fix speech-to-text errors, names, punctuation, and obvious garble.',
  'Keep the speaker\'s words, order, and meaning. Do not add facts or filler.',
  'Do not invent names that are not in the hints. If a word is still unintelligible, keep [?].',
  'Return only the corrected transcript.',
].join(' ');

function correctionUserText(source, { hint, keywords } = {}) {
  const names = sanitizeKeywords(keywords);
  const firstPass = clip(hint, 1500);
  const parts = [];
  if (names.length) parts.push(`Names that may appear: ${names.join(', ')}`);
  if (firstPass && firstPass !== source) parts.push(`Browser first-pass (may be wrong):\n${firstPass}`);
  parts.push(`Transcript:\n${source}`);
  return parts.join('\n\n');
}

/**
 * Clean speech-to-text the way the conversation agent later reads it:
 * names, punctuation, obvious garble — without inventing a new story.
 * Returns { text, debug }.
 */
async function correctTranscript(raw, options = {}) {
  const source = normalizeTranscript(raw);
  const started = Date.now();
  const live = Boolean(options.live);
  const model = correctModel();
  const user = correctionUserText(source, options);
  const debugOf = (output, note) => ({
    source: live ? 'Transcript correction (pause)' : 'Transcript correction',
    model,
    systemPrompt: CORRECT_SYSTEM,
    finalPrompt: user,
    output: output || '',
    elapsedMs: Date.now() - started,
    note: note || '',
  });

  if (!source) return { text: '', debug: debugOf('', 'Skipped — empty transcript') };
  if (!process.env.OPENAI_API_KEY) {
    return { text: source, debug: debugOf(source, 'Skipped — no API key') };
  }

  try {
    let result = await completeText({
      model,
      system: CORRECT_SYSTEM,
      user,
      maxTokens: live ? 1536 : 2048,
      kind: 'conversation',
      reasoningEffort: live ? 'minimal' : 'low',
      verbosity: 'low',
    });
    let out = normalizeTranscript(stripModelWrapper(result.text));
    if (!out && !live) {
      result = await completeText({
        model,
        system: CORRECT_SYSTEM,
        user,
        maxTokens: 4096,
        kind: 'conversation',
        reasoningEffort: 'low',
        verbosity: 'low',
      });
      out = normalizeTranscript(stripModelWrapper(result.text));
    }
    if (!out) {
      console.warn('[transcribe] correction empty — kept speech-to-text');
      return { text: source, debug: debugOf(source, 'Empty model output — kept speech-to-text') };
    }
    if (out.length > Math.max(source.length * 2.5, source.length + 80)) {
      console.warn('[transcribe] correction too long — kept speech-to-text');
      return { text: source, debug: debugOf(out, 'Rejected — model added too much. Kept speech-to-text.') };
    }
    if (out !== source) console.log(`[transcribe] corrected ${source.length} → ${out.length} chars`);
    else console.log('[transcribe] correction made no changes');
    return { text: out, debug: debugOf(out, out === source ? 'No changes from speech-to-text' : '') };
  } catch (err) {
    console.warn('[transcribe] correction skipped', err.message);
    return { text: source, debug: debugOf(source, `Correction failed: ${err.message}`) };
  }
}

function buildPrompt({ hint, whisper } = {}) {
  const base = clip(DEFAULT_PROMPT, whisper ? 700 : 2000);
  const firstPass = clip(hint, whisper ? 200 : 1500);
  if (!firstPass) return base;
  return `${base} A rough first-pass of this take: ${firstPass}`;
}

function isUnknownModelError(err) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  if (status === 404) return true;
  return /model/.test(msg) && /(not found|does not exist|invalid|unknown)/.test(msg);
}

function fallbackModels(preferred) {
  return [...new Set([preferred, 'gpt-transcribe', 'gpt-4o-transcribe', 'whisper-1'])];
}

function paramsFor(model, { file, hint, keywords }) {
  const kind = modelKind(model);
  const prompt = buildPrompt({ hint, whisper: kind === 'whisper' });
  const languages = parseLanguages();
  const names = sanitizeKeywords(keywords);

  if (kind === 'whisper') {
    const params = { file, model, prompt, temperature: 0 };
    if (languages[0]) params.language = languages[0];
    else params.language = 'en';
    return params;
  }

  const body = { file, model, prompt };
  if (kind === 'gpt-transcribe') {
    if (names.length) body.keywords = names;
    if (languages.length) body.languages = languages;
    return body;
  }

  if (languages[0]) body.language = languages[0];
  return body;
}

function isContextFieldError(err) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  if (status !== 400) return false;
  return /keyword|languages|unknown parameter|unrecognized/.test(msg);
}

async function createTranscription(client, model, ctx) {
  const body = paramsFor(model, ctx);
  try {
    return await client.audio.transcriptions.create(body);
  } catch (err) {
    if ((body.keywords || body.languages) && isContextFieldError(err)) {
      const { keywords, languages, ...rest } = body;
      return client.audio.transcriptions.create(rest);
    }
    throw err;
  }
}

/**
 * Transcribe a voice-note buffer. Returns { text, rawText }.
 * text is the AI-cleaned transcript used in the editor; rawText is the STT pass.
 * options.hint — live first-pass words, used as context (not as the transcript).
 * options.keywords — proper nouns we expect to hear (project names).
 */
async function transcribeAudio(buffer, contentType, options = {}) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('Voice transcription is not configured (set OPENAI_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  if (!buffer || !buffer.length) {
    const err = new Error('No audio to transcribe');
    err.statusCode = 400;
    throw err;
  }

  const client = getOpenAIClient();
  const file = await toFile(buffer, filenameFor(contentType), {
    type: contentType || 'audio/webm',
  });
  const ctx = {
    file,
    hint: options.hint,
    keywords: options.keywords,
  };

  const started = Date.now();
  let lastErr;
  for (const model of fallbackModels(transcribeModel())) {
    try {
      const result = await createTranscription(client, model, ctx);
      const rawText = normalizeTranscript(result.text);
      const sttMs = Date.now() - started;
      const corrected = await correctTranscript(rawText, options);
      return {
        text: corrected.text,
        rawText,
        debug: {
          source: 'Voice transcription',
          model: correctModel(),
          elapsedMs: Date.now() - started,
          agents: [
            {
              source: 'Speech-to-text',
              model,
              prompt: buildPrompt({ hint: options.hint, whisper: modelKind(model) === 'whisper' }),
              output: rawText,
              elapsedMs: sttMs,
              note: options.hint && options.hint !== rawText ? 'Browser live words were a hint only' : '',
            },
            corrected.debug,
          ],
        },
      };
    } catch (err) {
      lastErr = err;
      if (!isUnknownModelError(err)) throw err;
    }
  }
  throw lastErr;
}

module.exports = { transcribeAudio, correctTranscript };

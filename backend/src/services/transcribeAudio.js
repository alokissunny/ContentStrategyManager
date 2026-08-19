/*
 * Voice-note transcription for Capture. The conversation keeps the words, not
 * the audio — this turns a short recording into text the understander can read.
 */

const { toFile } = require('openai');
const getOpenAIClient = require('./openaiClient');

function transcribeModel() {
  return process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
}

function filenameFor(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('mp4') || ct.includes('m4a')) return 'note.m4a';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'note.mp3';
  if (ct.includes('wav')) return 'note.wav';
  if (ct.includes('ogg')) return 'note.ogg';
  return 'note.webm';
}

/**
 * Transcribe a voice-note buffer. Returns { text }.
 */
async function transcribeAudio(buffer, contentType) {
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
  const result = await client.audio.transcriptions.create({
    file,
    model: transcribeModel(),
  });
  return { text: String(result.text || '').trim() };
}

module.exports = { transcribeAudio };

import client from './client';
import { ingestPlanDebug } from './posts';

// Brand Kit › Voice profiles + Capture › Reel › voiceover › "Use my cloned voice"
// (ElevenLabs, backend services/voiceClone.js). A person may keep several profiles; one is the default.

// → { configured, cloned, profiles: [{ id, name, note, isDefault, createdAt }], max }
export async function getVoiceClone() {
  const { data } = await client.get('/voice-clone');
  return data;
}

// a new profile from voice samples (keys: S3 keys from uploadFiles) → { profile, profiles }
export async function createVoiceClone({ keys, consent, name = '', note = '' }) {
  const { data } = await client.post('/voice-clone', { keys, consent: consent === true, name, note });
  ingestPlanDebug('Voice profile · clone', data); // debug panel (only with x-debug-prompts)
  return data;
}

// the same profile cloned again from new samples (Re-record) → { profile, profiles }
export async function recloneVoiceProfile(id, { keys, consent }) {
  const { data } = await client.post(`/voice-clone/${encodeURIComponent(id)}/clone`, { keys, consent: consent === true });
  ingestPlanDebug('Voice profile · re-record', data);
  return data;
}

// { name?, note?, isDefault? } → { profiles }
export async function updateVoiceProfile(id, patch) {
  const { data } = await client.patch(`/voice-clone/${encodeURIComponent(id)}`, patch);
  return data;
}

// → { profiles }
export async function deleteVoiceProfile(id) {
  const { data } = await client.delete(`/voice-clone/${encodeURIComponent(id)}`);
  return data;
}

// a short line in that voice → { url }
export async function previewVoiceProfile(id) {
  const { data } = await client.post(`/voice-clone/${encodeURIComponent(id)}/preview`);
  ingestPlanDebug('Voice profile · play', data); // ElevenLabs credits for the sample line
  return data;
}

// one script part read in a cloned voice → { key, ms, url, tone } (a take like a recorded one).
// script: every part's words in order — the voice director reads the whole story to set this part's delivery.
// profileId: which voice profile ('' = the default)
export async function speakWithClone({ text, part, script = [], profileId = '' }) {
  const { data } = await client.post('/voice-clone/speak', { text, part, script, ...(profileId ? { profileId } : {}) });
  ingestPlanDebug(`Voiceover · cloned voice · part ${(Number(part) || 0) + 1}`, data); // director tokens + ElevenLabs credits
  return data;
}

import client from './client';

// Capture › Reel › voiceover › "Use my cloned voice" (ElevenLabs, backend services/voiceClone.js)
export async function getVoiceClone() {
  const { data } = await client.get('/voice-clone');
  return data; // { configured, cloned, createdAt }
}

// keys: S3 keys of the uploaded voice samples (uploadFiles)
export async function createVoiceClone({ keys, consent }) {
  const { data } = await client.post('/voice-clone', { keys, consent: consent === true });
  return data;
}

// one script part read in the cloned voice → { key, ms, url } (a take like a recorded one)
export async function speakWithClone({ text, part }) {
  const { data } = await client.post('/voice-clone/speak', { text, part });
  return data;
}

export async function deleteVoiceClone() {
  const { data } = await client.delete('/voice-clone');
  return data;
}

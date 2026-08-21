import client from './client';

// Re-run a prompt-debug Input against the same model.
// → { output, model }
export function rerunPrompt({ model, systemPrompt, prompt }) {
  return client
    .post('/debug/rerun-prompt', { model, systemPrompt, prompt })
    .then((res) => res.data);
}

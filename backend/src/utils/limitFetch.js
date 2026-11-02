// Caps how many model-provider HTTP calls one process has in flight at once.
// Wraps an SDK client's `fetch`, so every call (chat, responses, images,
// retries) passes through it; the SDK's own retry/backoff on 429 and 5xx stays
// as is and each retry queues afresh.
//
// Off unless <PREFIX>_MAX_CONCURRENCY (or LLM_MAX_CONCURRENCY) is set: the
// SDK's timeout clock starts before fetch, so time spent queued counts against
// it — pick a cap above normal peak, not below it.

function envInt(name) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function limitFetch(fetchFn, { name = 'llm', max = 0 } = {}) {
  const cap = max || envInt(`${name.toUpperCase()}_MAX_CONCURRENCY`) || envInt('LLM_MAX_CONCURRENCY');
  if (!cap || typeof fetchFn !== 'function') return fetchFn;
  let active = 0;
  const waiting = [];

  const release = () => {
    active -= 1;
    while (waiting.length && active < cap) {
      const next = waiting.shift();
      if (next.cancelled) continue;
      active += 1;
      next.go();
    }
  };

  const acquire = (signal) => new Promise((resolve, reject) => {
    if (active < cap) {
      active += 1;
      return resolve();
    }
    const entry = { cancelled: false, go: resolve };
    waiting.push(entry);
    if (waiting.length % 10 === 0) console.warn(`[limitFetch] ${name}: ${waiting.length} call(s) waiting (cap ${cap})`);
    if (signal) {
      const onAbort = () => {
        entry.cancelled = true;
        reject(signal.reason || new Error('aborted'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener?.('abort', onAbort, { once: true });
    }
  });

  const limited = async function limitedFetch(url, init) {
    await acquire(init?.signal);
    try {
      return await fetchFn.call(undefined, url, init);
    } finally {
      release();
    }
  };
  limited.stats = () => ({ active, waiting: waiting.filter((w) => !w.cancelled).length, cap });
  return limited;
}

// Applies the cap and an optional retry count (<PREFIX>_MAX_RETRIES) to an SDK
// client that calls `this.fetch` (openai v6, @anthropic-ai/sdk).
function hardenClient(client, name) {
  if (!client) return client;
  client.fetch = limitFetch(client.fetch, { name });
  const retries = Number(process.env[`${name.toUpperCase()}_MAX_RETRIES`]);
  if (Number.isInteger(retries) && retries >= 0 && retries <= 10) client.maxRetries = retries;
  return client;
}

module.exports = { limitFetch, hardenClient };

/*
 * Log context for queued plan runs. Every line logged while a job runs —
 * including the agents' own logs deep inside planOrchestrator — is prefixed
 * with the run and the job that produced it:
 *
 *   [run a1b2c3 @studio · post 2/3 · try 1/2 · w:host:4123] [planOrchestrator] Carousel:2026-10-09 done · 41.2s
 *
 * so two runs (or two posts of one run) interleaving in the same log stay
 * separable. Works through AsyncLocalStorage: no log call site needs to pass
 * the run id. PLAN_QUEUE_DEBUG=1 adds verbose queue events (polls, BullMQ
 * active/completed/stalled).
 */
const { AsyncLocalStorage } = require('node:async_hooks');
const os = require('node:os');

const store = new AsyncLocalStorage();

// One worker process: Render gives each instance its own hostname.
const WORKER_ID = `${os.hostname()}:${process.pid}`;

// Short, greppable run tag: last 6 chars of the PlanRun id + handle.
function runTag(runId, handle) {
  const id = String(runId || '');
  return `run ${id.slice(-6) || '?'}${handle ? ` @${handle}` : ''}`;
}

function withLogContext(context, fn) {
  return store.run(context, fn);
}

function logPrefix() {
  const ctx = store.getStore();
  if (!ctx) return '';
  return `[${[ctx.run, ctx.job].filter(Boolean).join(' · ')}]`;
}

let installed = false;
// Prefix console output with the active job's context. Lines logged outside
// a job (HTTP requests, the sync path) are left exactly as they were.
function installConsolePrefix() {
  if (installed) return;
  installed = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const prefix = logPrefix();
      if (!prefix) return original(...args);
      if (typeof args[0] === 'string') return original(`${prefix} ${args[0]}`, ...args.slice(1));
      return original(prefix, ...args);
    };
  }
}

function queueDebugEnabled() {
  return ['1', 'true', 'on', 'yes'].includes(String(process.env.PLAN_QUEUE_DEBUG || '').trim().toLowerCase());
}

function queueDebug(...args) {
  if (queueDebugEnabled()) console.log('[planQueue:debug]', ...args);
}

function seconds(ms) {
  return `${Math.round((Number(ms) || 0) / 100) / 10}s`;
}

module.exports = {
  WORKER_ID,
  runTag,
  withLogContext,
  installConsolePrefix,
  queueDebugEnabled,
  queueDebug,
  seconds,
};

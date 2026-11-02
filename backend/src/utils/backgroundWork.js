// Work the API runs after it has answered (Theme Apply jobs, fire-and-forget
// plan generation). Tracked so a deploy's SIGTERM can let it finish before the
// process exits instead of killing it mid-run.

const running = new Set();
let draining = false;

function track(promise) {
  const p = Promise.resolve(promise).catch(() => {});
  running.add(p);
  p.finally(() => running.delete(p));
  return promise;
}

const isDraining = () => draining;
const inFlight = () => running.size;

// Resolves once every tracked run settles, or after timeoutMs — whichever is first.
async function drain(timeoutMs) {
  draining = true;
  if (!running.size) return true;
  let timer;
  const timeout = new Promise((ok) => { timer = setTimeout(() => ok(false), timeoutMs); });
  const done = Promise.all([...running]).then(() => true);
  const finished = await Promise.race([done, timeout]);
  clearTimeout(timer);
  return finished;
}

module.exports = { track, drain, isDraining, inFlight };

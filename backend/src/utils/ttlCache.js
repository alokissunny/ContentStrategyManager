/**
 * Tiny in-process TTL cache for hot auth/profile lookups.
 * Atlas M0 from a remote region costs ~1–2s per round-trip; avoiding a
 * User.findById / currentUsername on every API call is the biggest local win.
 */

function createTtlCache({ ttlMs = 30_000, max = 500 } = {}) {
  const map = new Map();

  function get(key) {
    const hit = map.get(String(key));
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      map.delete(String(key));
      return undefined;
    }
    return hit.value;
  }

  function set(key, value, ttl = ttlMs) {
    const k = String(key);
    if (map.size >= max && !map.has(k)) {
      const first = map.keys().next().value;
      if (first != null) map.delete(first);
    }
    map.set(k, { value, expires: Date.now() + Math.max(0, ttl) });
    return value;
  }

  function del(key) {
    map.delete(String(key));
  }

  function clear() {
    map.clear();
  }

  return { get, set, del, clear };
}

module.exports = { createTtlCache };

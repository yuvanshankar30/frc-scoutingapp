// A small per-user limiter (in memory, per server instance): enough to stop a stuck client or a script from
// burning model credit. Not a security boundary; sign-in and row-level security are.
const hits = new Map();

export function allowRequest(userId, { limit = 12, windowMs = 60_000, now = Date.now() } = {}) {
  const recent = (hits.get(userId) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) for (const [key, times] of hits) if (!times.some((t) => now - t < windowMs)) hits.delete(key);
  return true;
}

export function resetRateLimit() {
  hits.clear();
}

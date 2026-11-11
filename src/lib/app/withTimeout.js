// Resolves with `promise`, or with `fallback` once `ms` pass first. At a competition the phone's connection can stall
// a request forever instead of failing it, and a save that awaits a stalled call never reaches its own timeout or the
// offline queue. The stalled call keeps running in the background; only the wait is cut short.
export function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/** Like withTimeout, but rejects with an Error named TimeoutError instead of resolving a fallback. */
export function rejectAfter(promise, ms, message = 'Timed out') {
  const marker = Symbol('timeout');
  return withTimeout(promise, ms, marker).then((value) => {
    if (value === marker) {
      const error = new Error(message);
      error.name = 'TimeoutError';
      throw error;
    }
    return value;
  });
}

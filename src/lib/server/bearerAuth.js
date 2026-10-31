// Shared-secret bearer tokens (the vision runner token, cron secrets): read the token from a request and
// compare it in constant time.
import crypto from 'node:crypto';

/** The token from an `Authorization: Bearer …` header ('' when there isn't one). Takes Headers or a plain object. */
export function bearerToken(headers) {
  const raw =
    typeof headers?.get === 'function'
      ? headers.get('authorization')
      : headers?.authorization || headers?.Authorization;
  const match = /^Bearer\s+(.+)$/i.exec(String(raw || '').trim());
  return match ? match[1].trim() : '';
}

/** Constant-time comparison of two secrets. */
export function tokensMatch(candidate, expected) {
  if (!candidate || !expected) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** True when the request carries `expected` (trimmed) as its bearer token. */
export function hasBearerToken(request, expected) {
  return tokensMatch(bearerToken(request?.headers), typeof expected === 'string' ? expected.trim() : '');
}

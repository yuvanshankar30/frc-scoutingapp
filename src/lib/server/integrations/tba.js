// One client for The Blue Alliance's read API (v3). Every server call to TBA goes through here, so
// the key, the timeout and the error shape live in one place. A competition code can track a
// different TBA event (Scouting Admin > Event setup); tbaEventKeyFor / relabelTbaPayload translate.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { allowRequest } from '$lib/server/assistant/rateLimit.js';
import { PUBLIC_EVENT_CACHE } from '$lib/server/integrations/httpCache.js';

export const TBA_API_BASE = 'https://www.thebluealliance.com/api/v3';
const DEFAULT_TIMEOUT_MS = 15_000;
export const MISSING_TBA_KEY = 'Server missing TBA_API_KEY';

/** An error with the HTTP status a route should answer with. */
export class TbaError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

/** The server's TBA read key ('' when none is set). */
export const tbaAuthKey = () => env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY || '';

/**
 * The raw Response for a TBA API path such as `/event/2026cc/teams/simple`.
 * Throws TbaError(500) when there is no key; network errors and timeouts throw as-is.
 */
export async function tbaFetch(
  path,
  { authKey = tbaAuthKey(), fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}
) {
  if (!authKey) throw new TbaError(MISSING_TBA_KEY, 500);
  const url = `${TBA_API_BASE}${String(path).startsWith('/') ? '' : '/'}${path}`;
  return fetchImpl(url, { headers: { 'X-TBA-Auth-Key': authKey }, signal: AbortSignal.timeout(timeoutMs) });
}

/** Parsed JSON for a TBA path, or null on a missing key, a network failure or a non-OK answer. Never throws. */
export async function tbaJson(path, options) {
  try {
    const response = await tbaFetch(path, options);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * For the /api/tba/* proxies: parsed JSON, or a TbaError. A 404 returns `notFound` when the option is
 * given (a value, or a TbaError to throw).
 */
export async function tbaGet(path, { notFound, ...options } = {}) {
  const response = await tbaFetch(path, options);
  if (response.status === 404 && notFound !== undefined) {
    if (notFound instanceof TbaError) throw notFound;
    return notFound;
  }
  if (!response.ok) throw new TbaError(`TBA upstream error ${response.status}`, 502);
  return response.json();
}

/** "2026 Silicon Valley Regional" for a TBA event key, or null when TBA has no such event (or no key is set). */
export async function tbaEventName(tbaEventKey) {
  const data = await tbaJson(`/event/${encodeURIComponent(tbaEventKey)}/simple`);
  return data?.name ? `${data.year} ${data.name}` : null;
}

const failure = (error) =>
  json({ success: false, error: error?.message || 'Fetch failed' }, { status: error?.status || 500 });

// The /api/tba/* proxies need no sign-in (the data is public, and pages call them before the session loads), so a
// script could burn through the server's TBA key quota. This caps each address at a
// rate no real use comes near. It is deliberately high: at an event every scout can share one venue IP.
export const TBA_PROXY_LIMIT_PER_MINUTE = 1200;

function clientAddress(event) {
  try {
    return event.getClientAddress?.() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * A GET handler for an /api/tba/* proxy. `load(event)` returns the `data` for `{ success: true, data }`
 * (or a Response to send as-is) and throws TbaError for anything else. `cache` adds the shared public
 * cache headers to successful answers.
 */
export function tbaProxy(load, { cache = false } = {}) {
  return async (event) => {
    if (!allowRequest(`tba-proxy:${clientAddress(event)}`, { limit: TBA_PROXY_LIMIT_PER_MINUTE, windowMs: 60_000 }))
      return json({ success: false, error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
    try {
      const data = await load(event);
      if (data instanceof Response) return data;
      if (cache) event.setHeaders(PUBLIC_EVENT_CACHE);
      return json({ success: true, data });
    } catch (error) {
      return failure(error);
    }
  };
}

/** A required, trimmed query parameter (TbaError 400 when it's missing). */
export function requiredParam(url, name) {
  const value = String(url.searchParams.get(name) || '').trim();
  if (!value) throw new TbaError(`${name} required`, 400);
  return value;
}

/** A `frc<number>` team key from the query (TbaError 400 when it isn't one). */
export function teamKeyParam(url, name = 'team_key') {
  const value = String(url.searchParams.get(name) || '')
    .trim()
    .toLowerCase();
  if (!/^frc\d+$/.test(value)) throw new TbaError(`valid ${name} required`, 400);
  return value;
}

/** A four-digit `year` from the query, defaulting to the current year. */
export function yearParam(url) {
  const raw = String(url.searchParams.get('year') || '').trim();
  return /^\d{4}$/.test(raw) ? raw : String(new Date().getFullYear());
}

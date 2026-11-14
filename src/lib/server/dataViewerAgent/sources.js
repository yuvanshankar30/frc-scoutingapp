// Outside FRC data the analysis agent may read: The Blue Alliance, FIRST's official FRC Events API, Match13 and
// Statbotics. The model only ever names a source and a path; the server builds the request from a fixed base, so it
// can't be pointed at any other host. Each source has a path allowlist, a timeout, a response size cap, a short
// in-memory cache and a per-minute ceiling under the service's own limit. A failure never throws: the model gets
// { error } and can say the source was unavailable.
//
// FIRST and Match13 credentials are NOT in this app: they are secrets of the Supabase Edge Function frc-data
// (supabase/functions/frc-data), which this server calls with the project's service-role key. TBA (TBA_API_KEY, which
// the app already uses everywhere) and Statbotics (no key) are called directly.
import { TBA_API_BASE } from '$lib/server/integrations/tba.js';

const MINUTE = 60_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 2_000_000;
const CACHE_LIMIT = 300;
// Path pieces: letters, digits, _ and - only, so no "..", "//", "@", "%" or scheme can sneak in.
const SEGMENT = '[A-Za-z0-9_-]+';
const QUERY = '(\\?[A-Za-z0-9_=&.,-]{1,200})?';
// FIRST and Match13: every endpoint, as plain path segments and a plain query (the same rule as frc-data's).
const ANY_ENDPOINT = /^(\/[A-Za-z0-9_.~:-]+)+\/?(\?[A-Za-z0-9_=&.,:~+-]{1,500})?$/;

const tbaKey = (env) => env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY || '';
const supabaseUrl = (env) => String(env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = (env) => String(env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '');
/** The frc-data Edge Function can be called when the server knows the project and its service-role key. */
const functionReachable = (env) => Boolean(supabaseUrl(env) && serviceKey(env));

export const SOURCES = Object.freeze({
  tba: {
    label: 'The Blue Alliance',
    base: TBA_API_BASE,
    perMinute: 120,
    // /event/2026cc/matches, /team/frc5940/event/2026cc/status, /match/2026cc_qm12, /district/2026ca/rankings, …
    paths: [new RegExp(`^/(status|event|events|team|teams|match|district|districts)(/${SEGMENT}){0,5}$`)],
    ttlMs: MINUTE,
    configured: (env) => Boolean(tbaKey(env)),
    headers: (env) => ({ 'X-TBA-Auth-Key': tbaKey(env) }),
    help: 'TBA API v3 path, e.g. /event/2026cc/rankings, /event/2026cc/matches/simple, /team/frc5940/events/2026/statuses, /match/2026cc_qm12'
  },
  first: {
    label: 'FIRST FRC Events',
    viaFunction: true,
    // FIRST asks that "significant volume" be cleared with them first, so we stay modest.
    perMinute: 60,
    // Every FRC Events v3.0 endpoint, e.g. /2026/rankings/CC, /2026/matches/CC?tournamentLevel=Qualification
    paths: [ANY_ENDPOINT],
    ttlMs: MINUTE,
    configured: functionReachable,
    help: 'Any FRC Events API v3.0 path, starting with the season, e.g. /2026/rankings/CC, /2026/matches/CC?tournamentLevel=Qualification, /2026/scores/CC/Qualification, /2026/alliances/CC'
  },
  match13: {
    label: 'Match13',
    viaFunction: true,
    // Match13 allows 60 a minute, 1000 an hour and 30000 a week for the whole account (every key together), so the
    // agent keeps well under it; the frc-data function has its own ceiling on top.
    perMinute: 20,
    // Every Match13 read API v1 endpoint, e.g. /years/2026/teams, /teams/5940/years/2026, /events/2026cc/sim
    paths: [ANY_ENDPOINT],
    ttlMs: 5 * MINUTE,
    configured: functionReachable,
    help: 'Any Match13 read API v1 path, e.g. /years/2026/teams, /teams/5940/years/2026 (xP rating), /events/2026cc, /events/2026cc/sim (forecasts)'
  },
  statbotics: {
    label: 'Statbotics',
    base: 'https://api.statbotics.io/v3',
    perMinute: 60,
    // /team_event/5940/2026cc, /team_events?event=2026cc&limit=100, /event/2026cc, /matches?event=2026cc
    paths: [
      new RegExp(
        `^/(team|teams|year|years|team_year|team_years|event|events|team_event|team_events|team_match|team_matches|match|matches)(/${SEGMENT}){0,3}${QUERY}$`
      )
    ],
    ttlMs: 5 * MINUTE,
    configured: () => true,
    headers: () => ({}),
    help: 'Statbotics v3 path, e.g. /team_events?event=2026cc&limit=100, /team_event/5940/2026cc, /event/2026cc, /matches?event=2026cc'
  }
});

/** Which sources this server can reach, for the model's system prompt and the page's status line. */
export function sourceStatus(env = {}) {
  return Object.fromEntries(
    Object.entries(SOURCES).map(([key, source]) => [key, { label: source.label, configured: source.configured(env) }])
  );
}

/** Why a path is refused, or null when the source allows it. */
export function pathProblem(sourceKey, path) {
  const source = SOURCES[sourceKey];
  if (!source) return `Unknown source ${sourceKey}.`;
  const value = String(path ?? '').trim();
  if (!value.startsWith('/')) return 'The path must start with /.';
  if (value.length > 300) return 'That path is too long.';
  if (!source.paths.some((pattern) => pattern.test(value)))
    return `That path is not one this source allows. ${source.help}.`;
  if (
    value
      .split('?')[0]
      .split('/')
      .some((segment) => segment === '.' || segment === '..')
  )
    return 'A path cannot step up with "." or "..".';
  return null;
}

const cache = new Map();
// Request times per source in the last minute (this server instance), for the perMinute ceilings.
const recent = new Map();
export function clearSourceCache() {
  cache.clear();
  recent.clear();
}

function withinLimit(sourceKey, now) {
  const times = (recent.get(sourceKey) || []).filter((at) => now - at < MINUTE);
  if (times.length >= SOURCES[sourceKey].perMinute) {
    recent.set(sourceKey, times);
    return false;
  }
  times.push(now);
  recent.set(sourceKey, times);
  return true;
}

const failure = (label, error) =>
  error?.name === 'TimeoutError' ? `${label} did not answer in time.` : `${label} could not be reached.`;

/** FIRST or Match13 through the frc-data Edge Function: { url, data } or { url?, error }. */
async function viaFunction(sourceKey, path, env, fetchImpl) {
  const source = SOURCES[sourceKey];
  try {
    const response = await fetchImpl(`${supabaseUrl(env)}/functions/v1/frc-data`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey(env)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: sourceKey, path }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
    const payload = await response.json().catch(() => null);
    if (!payload) return { error: `${source.label} could not be reached (frc-data answered ${response.status}).` };
    if (payload.error) return { url: payload.url, error: payload.error };
    return { url: payload.url, data: payload.data };
  } catch (error) {
    return { error: failure(source.label, error) };
  }
}

/** A direct GET to TBA or Statbotics: { url, data } or { url, error }. */
async function direct(sourceKey, path, env, fetchImpl) {
  const source = SOURCES[sourceKey];
  const url = `${source.base}${path}`;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', ...source.headers(env) },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    });
    if (!response.ok)
      return {
        url,
        error:
          response.status === 404
            ? `${source.label} has nothing at that path.`
            : `${source.label} answered ${response.status}.`
      };
    const length = Number(response.headers?.get?.('content-length') || 0);
    if (length > MAX_BODY_BYTES) return { url, error: `${source.label} sent too much data.` };
    const body = await response.text();
    if (body.length > MAX_BODY_BYTES) return { url, error: `${source.label} sent too much data.` };
    return { url, data: body ? JSON.parse(body) : null };
  } catch (error) {
    return { url, error: failure(source.label, error) };
  }
}

/**
 * GET one path from a source: { source, url, data } or { source, error }. Answers are cached briefly per source and
 * path, so a model that asks twice in one conversation (or two people asking at once) costs one request.
 */
export async function fetchSource(sourceKey, path, { env = {}, fetchImpl = fetch, now = Date.now() } = {}) {
  const problem = pathProblem(sourceKey, path);
  if (problem) return { source: sourceKey, error: problem };
  const source = SOURCES[sourceKey];
  if (!source.configured(env)) return { source: sourceKey, error: `${source.label} is not set up on this server.` };
  const clean = String(path).trim();
  const key = `${sourceKey}:${clean}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < source.ttlMs) return { source: sourceKey, url: hit.url, data: hit.data, cached: true };
  if (!withinLimit(sourceKey, now))
    return { source: sourceKey, error: `${source.label} is busy (our own pacing); try again in a minute.` };
  const result = await (source.viaFunction ? viaFunction : direct)(sourceKey, clean, env, fetchImpl);
  if (result.error) return { source: sourceKey, ...(result.url ? { url: result.url } : {}), error: result.error };
  cache.set(key, { at: now, url: result.url, data: result.data });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return { source: sourceKey, url: result.url, data: result.data };
}

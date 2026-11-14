// frc-data: the only place the FIRST FRC Events API and Match13 credentials live. They are Supabase Edge Function
// secrets (FRC_API_USERNAME, FRC_API_TOKEN, MATCH13_API_KEY), never the app's own environment, so the app never
// carries them. Servers call this function with the project's service-role key and get the service's JSON
// back; a browser or an ordinary signed-in account is refused, so nobody else can spend the FIRST or Match13 quota.
//
// Read-only: GET to a fixed base URL per source. Any endpoint of the service can be read, but a path is only plain
// segments (letters, digits and _ . ~ : -, never "." or ".."), the query only plain characters, and the final URL must
// still be on the service's own host and base path, so a request can never leave the service. A 10 s timeout, a 2 MB
// cap, a short cache and a per-minute ceiling under each service's limit. Pure, so it is tested with vitest (src/lib/server/dataViewerAgent/frcDataFunction.test.js);
// index.ts wires it to Deno.serve.

const MINUTE = 60_000;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
// Every endpoint of a service: plain path segments, then an optional plain query string.
const ANY_ENDPOINT = /^(\/[A-Za-z0-9_.~:-]+)+\/?(\?[A-Za-z0-9_=&.,:~+-]{1,500})?$/;

type Env = Record<string, string | undefined>;
type Source = {
  label: string;
  base: string;
  perMinute: number;
  ttlMs: number;
  paths: RegExp[];
  headers: (env: Env) => Record<string, string> | null;
};

export const SOURCES: Record<string, Source> = {
  first: {
    label: 'FIRST FRC Events',
    base: 'https://frc-api.firstinspires.org/v3.0',
    // FIRST asks that "significant volume" be cleared with them first.
    perMinute: 60,
    ttlMs: MINUTE,
    // Every FRC Events v3.0 endpoint, e.g. /2026/rankings/CC, /2026/matches/CC?tournamentLevel=Qualification,
    // /2026/schedule/CC/Qualification/hybrid, /2026/awards/event/CC, /2026/teams?eventCode=CC
    paths: [ANY_ENDPOINT],
    headers: (env) =>
      env.FRC_API_USERNAME && env.FRC_API_TOKEN
        ? { Authorization: `Basic ${btoa(`${env.FRC_API_USERNAME}:${env.FRC_API_TOKEN}`)}` }
        : null
  },
  match13: {
    label: 'Match13',
    base: 'https://actions.match13.com/v1',
    // Match13 allows 60 a minute, 1000 an hour and 30000 a week for the whole account; stay well under it.
    perMinute: 40,
    ttlMs: 5 * MINUTE,
    // Every Match13 read API v1 endpoint, e.g. /years, /years/2026/teams, /teams/5940/years/2026, /events/2026cc/sim
    paths: [ANY_ENDPOINT],
    headers: (env) => (env.MATCH13_API_KEY ? { Authorization: `Bearer ${env.MATCH13_API_KEY}` } : null)
  }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

/** Why a path is refused for a source, or null when it is allowed. */
export function pathProblem(source: string, path: unknown): string | null {
  const config = SOURCES[source];
  if (!config) return `Unknown source "${source}"; use ${Object.keys(SOURCES).join(' or ')}.`;
  const value = String(path ?? '').trim();
  if (!value.startsWith('/')) return 'The path must start with /.';
  if (value.length > 300) return 'That path is too long.';
  if (!config.paths.some((pattern) => pattern.test(value)))
    return `That path has characters ${config.label} paths don't use (plain letters, digits and _ . ~ : - only).`;
  const segments = value.split('?')[0].split('/').slice(1);
  if (segments.some((segment) => segment === '.' || segment === '..')) return 'A path cannot step up with "." or "..".';
  // Belt and braces: the URL as built must still be on the service's host, under its base path.
  const base = new URL(config.base);
  const url = new URL(`${config.base}${value}`);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`)) return 'That path leaves the service.';
  return null;
}

/** Constant-time compare, so the service key can't be guessed a character at a time. */
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The project's secret keys this function was given: the legacy service-role JWT and any new-style secret keys. */
function secretKeys(env: Env) {
  const keys = [env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SECRET_KEY];
  try {
    // New-style projects pass every secret key as a JSON object { name: key }.
    keys.push(...Object.values(JSON.parse(env.SUPABASE_SECRET_KEYS || '{}') as Record<string, string>));
  } catch {
    /* not set, or not JSON */
  }
  return keys.filter((key): key is string => typeof key === 'string' && key.length > 0);
}

/** The role claim of a JWT, or ''. Only trusted because Supabase's gateway has already verified the signature. */
function jwtRole(token: string) {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return String(JSON.parse(json)?.role || '');
  } catch {
    return '';
  }
}

/**
 * A server of ours: the bearer is one of the project's secret keys, or a service_role JWT. The second relies on the
 * gateway's JWT check, which supabase/config.toml keeps on for this function (verify_jwt = true): never deploy it with
 * --no-verify-jwt.
 */
export function isServiceCaller(token: string, env: Env) {
  if (!token) return false;
  if (secretKeys(env).some((key) => sameSecret(token, key))) return true;
  return jwtRole(token) === 'service_role';
}

const cache = new Map<string, { at: number; data: unknown }>();
const recent = new Map<string, number[]>();
export function resetState() {
  cache.clear();
  recent.clear();
}
function withinLimit(source: string, now: number) {
  const times = (recent.get(source) || []).filter((at) => now - at < MINUTE);
  const ok = times.length < SOURCES[source].perMinute;
  if (ok) times.push(now);
  recent.set(source, times);
  return ok;
}

/**
 * POST { source: 'first' | 'match13', path } -> { source, url, data, cached? } or { source, error }.
 * POST { action: 'status' } -> { sources: { first: { configured }, match13: { configured } } }.
 */
export async function handle(
  request: Request,
  { env, fetchImpl = fetch, now = Date.now() }: { env: Env; fetchImpl?: typeof fetch; now?: number }
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!isServiceCaller(token, env)) return reply({ error: 'Only the apps’ servers may call this function.' }, 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return reply({ error: 'Send JSON.' }, 400);

  if (body.action === 'status')
    return reply({
      sources: Object.fromEntries(
        Object.entries(SOURCES).map(([key, config]) => [key, { label: config.label, configured: Boolean(config.headers(env)) }])
      )
    });

  const source = String(body.source || '');
  const problem = pathProblem(source, body.path);
  if (problem) return reply({ source, error: problem }, 400);
  const config = SOURCES[source];
  const headers = config.headers(env);
  if (!headers) return reply({ source, error: `${config.label} is not set up (its secret is missing).` }, 503);

  const path = String(body.path).trim();
  const url = `${config.base}${path}`;
  const hit = cache.get(url);
  if (hit && now - hit.at < config.ttlMs) return reply({ source, url, data: hit.data, cached: true });
  if (!withinLimit(source, now))
    return reply({ source, url, error: `${config.label} is busy (our own pacing); try again in a minute.` }, 429);

  try {
    const upstream = await fetchImpl(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!upstream.ok) {
      const error =
        upstream.status === 404
          ? `${config.label} has nothing at that path.`
          : upstream.status === 401 || upstream.status === 403
            ? `${config.label} refused our credentials; check the function's secrets.`
            : upstream.status === 429
              ? `${config.label} is rate limiting us; try again later.`
              : `${config.label} answered ${upstream.status}.`;
      return reply({ source, url, error }, upstream.status === 404 ? 404 : 502);
    }
    const text = await upstream.text();
    if (text.length > MAX_BYTES) return reply({ source, url, error: `${config.label} sent too much data.` }, 502);
    const data = text ? JSON.parse(text) : null;
    cache.set(url, { at: now, data });
    if (cache.size > 300) cache.delete(cache.keys().next().value as string);
    return reply({ source, url, data });
  } catch (error) {
    const timedOut = (error as Error)?.name === 'TimeoutError';
    return reply(
      { source, url, error: timedOut ? `${config.label} did not answer in time.` : `${config.label} could not be reached.` },
      timedOut ? 504 : 502
    );
  }
}

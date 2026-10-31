import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimit } from '$lib/server/assistant/rateLimit.js';

let actor = null;
let profile = null;
let ilikeCalls = [];

const makeChain = (table) => {
  const rows = table === 'user_profiles' ? (profile ? [profile] : []) : [];
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    ilike: (col, val) => {
      ilikeCalls.push({ table, col, val });
      return query;
    },
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: rows[0] || null, error: null }),
    then: (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve)
  };
  return query;
};

const client = {
  auth: {
    getUser: async () => ({ data: { user: actor } })
  },
  from: makeChain
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => client }));
vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => client }));
vi.mock('$lib/server/integrations/google_service_account.js', () => ({
  getServiceAccountAccessToken: vi.fn(async () => 'mock-google-token')
}));
vi.mock('$env/dynamic/private', () => ({
  env: { GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY: '{"type":"service_account"}' }
}));

const { GET, POST } = await import('./+server.js');

const req = (body = null) => ({
  headers: { get: () => 'Bearer test' },
  json: async () => body
});

describe('/api/scouting-report', () => {
  beforeEach(() => {
    resetRateLimit();
    actor = { id: 'u1', email: 'scout@example.test' };
    profile = {
      id: 'u1',
      role: 'member',
      general_role: 'member',
      permissions: ['CAN_SEE_ROUTES'],
      banned: false,
      full_name: 'Scout One'
    };
    ilikeCalls = [];
    vi.restoreAllMocks();
  });

  it('rejects unauthenticated GET and POST requests with 401', async () => {
    actor = null;
    const getRes = await GET({ request: req(), url: new URL('https://test/api/scouting-report?event_key=2026cc') });
    expect(getRes.status).toBe(401);
    const postRes = await POST({ request: req({ action: 'export-google-doc', event_key: '2026cc' }) });
    expect(postRes.status).toBe(401);
  });

  it('rejects unapproved signed-in accounts with 403 before querying event data', async () => {
    profile = { id: 'u1', role: 'member', general_role: 'none', permissions: [], banned: false };
    const getRes = await GET({ request: req(), url: new URL('https://test/api/scouting-report?event_key=2026cc') });
    expect(getRes.status).toBe(403);
    expect(ilikeCalls).toEqual([]);

    const postRes = await POST({ request: req({ action: 'export-google-doc', event_key: '2026cc' }) });
    expect(postRes.status).toBe(403);
    expect(ilikeCalls).toEqual([]);
  });

  it('rejects banned users with 403 even if they have admin role or CAN_SEE_ROUTES', async () => {
    profile = { id: 'u1', role: 'admin', general_role: 'lead', permissions: ['CAN_SEE_ROUTES'], banned: true };
    const getRes = await GET({ request: req(), url: new URL('https://test/api/scouting-report?event_key=2026cc') });
    expect(getRes.status).toBe(403);
    expect(ilikeCalls).toEqual([]);
  });

  it('rejects wildcard or invalid event_key values and escapes the underscore separator in ILIKE', async () => {
    const badRes = await GET({ request: req(), url: new URL('https://test/api/scouting-report?event_key=%25') });
    expect(badRes.status).toBe(400);
    expect(ilikeCalls).toEqual([]);

    const okRes = await GET({ request: req(), url: new URL('https://test/api/scouting-report?event_key=2026cc') });
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('cache-control')).toBe('private, no-store');
    expect(ilikeCalls).toEqual([
      { table: 'scout_data_events', col: 'match_key', val: '2026cc\\_%' },
      { table: 'scout_notes', col: 'match_key', val: '2026cc\\_%' }
    ]);
  });

  it('shares exported Google Docs with reader role and rate-limits repeated exports', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/v1/documents') && !String(url).includes(':batchUpdate')) {
        return new Response(JSON.stringify({ documentId: 'doc-123' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const first = await POST({ request: req({ action: 'export-google-doc', event_key: '2026cc' }) });
    expect(first.status).toBe(200);
    const permCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/permissions'));
    expect(permCall).toBeTruthy();
    expect(JSON.parse(permCall[1].body)).toMatchObject({
      type: 'user',
      role: 'reader',
      emailAddress: 'scout@example.test'
    });

    const second = await POST({ request: req({ action: 'export-google-doc', event_key: '2026cc' }) });
    expect(second.status).toBe(200);

    const third = await POST({ request: req({ action: 'export-google-doc', event_key: '2026cc' }) });
    expect(third.status).toBe(429);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

let actor = null;
let profile = null;
let rosterRows = [];
let settingsRow = { event_key: '2026cc', manual_teams: ['frc5940', 'frc254'] };
let upserts = [];

const makeQuery = (table) => {
  const query = {
    select: () => query,
    eq: () => query,
    upsert: (payload) => {
      upserts.push(payload);
      settingsRow = { ...settingsRow, ...payload };
      return query;
    },
    single: async () => ({
      data: table === 'scouting_settings' ? settingsRow : table === 'user_profiles' ? profile : null,
      error: null
    }),
    maybeSingle: async () => ({
      data: table === 'scouting_settings' ? settingsRow : table === 'user_profiles' ? profile : null,
      error: null
    }),
    then: (resolve) => {
      const data =
        table === 'roster_entries' ? rosterRows : table === 'scouting_events' ? [{ event_key: '2026practice' }] : [];
      return Promise.resolve({ data, error: null }).then(resolve);
    }
  };
  return query;
};

const client = {
  auth: {
    getUser: async () => ({ data: { user: actor } })
  },
  from: makeQuery
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => client }));
vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => client }));

const { GET, POST } = await import('./+server.js');

const makeRequest = (body = null) => ({
  headers: { get: () => 'Bearer test' },
  json: async () => body
});

describe('/api/scouting-config', () => {
  beforeEach(() => {
    actor = { id: 'u1', email: 'scout@example.test' };
    profile = {
      id: 'u1',
      role: 'member',
      general_role: 'member',
      permissions: ['CAN_SEE_ROUTES'],
      banned: false
    };
    rosterRows = [];
    settingsRow = { event_key: '2026cc', manual_teams: ['frc5940', 'frc254'] };
    upserts = [];
  });

  it('rejects unauthenticated GET and POST requests with 401 and sets private, no-store cache headers', async () => {
    actor = null;
    const headers = {};
    const getRes = await GET({
      url: new URL('https://test/api/scouting-config?events=1'),
      request: makeRequest(),
      setHeaders: (h) => Object.assign(headers, h)
    });
    expect(getRes.status).toBe(401);
    expect(headers['cache-control']).toBe('private, no-store');
    expect(getRes.headers.get('cache-control')).toBe('private, no-store');

    const postRes = await POST({ request: makeRequest({ event_key: '2026mttd' }) });
    expect(postRes.status).toBe(401);
  });

  it('rejects unapproved and banned users on GET with 403', async () => {
    profile = { id: 'u1', role: 'member', general_role: 'none', permissions: [], banned: false };
    const unapprovedRes = await GET({
      url: new URL('https://test/api/scouting-config?events=1'),
      request: makeRequest(),
      setHeaders: () => {}
    });
    expect(unapprovedRes.status).toBe(403);

    profile = { id: 'u1', role: 'admin', general_role: 'lead', permissions: ['CAN_SEE_ROUTES'], banned: true };
    const bannedRes = await GET({
      url: new URL('https://test/api/scouting-config?events=1'),
      request: makeRequest(),
      setHeaders: () => {}
    });
    expect(bannedRes.status).toBe(403);
  });

  it('returns active event, manual teams, and available events for approved users with private cache-control', async () => {
    const headers = {};
    const res = await GET({
      url: new URL('https://test/api/scouting-config?events=1'),
      request: makeRequest(),
      setHeaders: (h) => Object.assign(headers, h)
    });
    expect(res.status).toBe(200);
    expect(headers['cache-control']).toBe('private, no-store');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body.data.event_key).toBe('2026cc');
    expect(body.data.manual_teams).toEqual(['frc5940', 'frc254']);
    expect(body.data.available_events.map((e) => e.value)).toContain('2026practice');
  });

  it('restricts POST event_key updates to non-banned scouting admins and validates event_key', async () => {
    const memberRes = await POST({ request: makeRequest({ event_key: '2026mttd' }) });
    expect(memberRes.status).toBe(403);
    expect(upserts).toEqual([]);

    rosterRows = [{ key: { key_name: 'Picklist 1 Lead' } }];
    profile.banned = true;
    const bannedAdminRes = await POST({ request: makeRequest({ event_key: '2026mttd' }) });
    expect(bannedAdminRes.status).toBe(403);
    expect(upserts).toEqual([]);

    profile.banned = false;
    const invalidKeyRes = await POST({ request: makeRequest({ event_key: 'invalid key!' }) });
    expect(invalidKeyRes.status).toBe(400);

    const okRes = await POST({ request: makeRequest({ event_key: '2026MTTD' }) });
    expect(okRes.status).toBe(200);
    expect(upserts[0]).toMatchObject({ id: 1, event_key: '2026mttd', updated_by: 'u1' });
  });
});

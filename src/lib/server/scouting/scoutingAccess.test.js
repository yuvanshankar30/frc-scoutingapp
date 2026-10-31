import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser = null;
let profileRow = null;
let rosterRows = [];

const authedClient = {
  tag: 'authed-client',
  auth: {
    getUser: async () => ({ data: { user: currentUser } })
  }
};

const serviceClient = {
  tag: 'service-client',
  from: (table) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: table === 'user_profiles' ? profileRow : null, error: null }),
      then: (resolve) =>
        Promise.resolve({ data: table === 'roster_entries' ? rosterRows : [], error: null }).then(resolve)
    };
    return query;
  }
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => authedClient }));
vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => serviceClient }));

const { actorFor, canAdministerFrom, isApprovedProfile, requireApprovedUser } = await import('./scoutingAccess.js');

const makeRequest = () => ({ headers: { get: () => 'Bearer test' } });

describe('scoutingAccess', () => {
  beforeEach(() => {
    currentUser = { id: 'u1', email: 'scout@example.test' };
    profileRow = {
      id: 'u1',
      role: 'member',
      general_role: 'member',
      permissions: ['CAN_SEE_ROUTES'],
      banned: false
    };
    rosterRows = [];
  });

  it('rejects null, unapproved, and banned profiles in isApprovedProfile', () => {
    expect(isApprovedProfile(null)).toBe(false);
    expect(isApprovedProfile({ role: 'member', general_role: 'none', permissions: [], banned: false })).toBe(false);
    expect(isApprovedProfile({ role: 'admin', permissions: ['CAN_SEE_ROUTES'], banned: true })).toBe(false);
    expect(
      isApprovedProfile({ role: 'member', general_role: 'member', permissions: ['CAN_SEE_ROUTES'], banned: false })
    ).toBe(true);
    expect(isApprovedProfile({ role: 'admin', permissions: [], banned: false })).toBe(true);
  });

  it('revokes admin access when profile.banned is true in canAdministerFrom', () => {
    expect(canAdministerFrom({ role: 'admin', banned: false }, [])).toBe(true);
    expect(canAdministerFrom({ role: 'admin', banned: true }, ['scouting lead'])).toBe(false);
    expect(canAdministerFrom({ role: 'member', banned: false }, ['Pit Lead'])).toBe(true);
    expect(canAdministerFrom({ role: 'member', banned: false }, ['Competition Lead'])).toBe(true);
    expect(canAdministerFrom({ role: 'member', banned: false }, ['Scouting Admin'])).toBe(false);
    expect(canAdministerFrom({ role: 'member', banned: true }, ['Pit Lead'])).toBe(false);
  });

  it('returns 401 and request-scoped db when not signed in', async () => {
    currentUser = null;
    const access = await requireApprovedUser(makeRequest());
    expect(access).toMatchObject({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      actorId: null,
      approved: false,
      canAdminister: false
    });
    expect(access.db).toBe(authedClient);
  });

  it('blocks unapproved signed-in users from receiving actorId or service-role db', async () => {
    profileRow = { id: 'u1', role: 'member', general_role: 'none', permissions: [], banned: false };
    const actor = await actorFor(makeRequest());
    expect(actor.actorId).toBeNull();
    expect(actor.authenticatedUserId).toBe('u1');
    expect(actor.approved).toBe(false);
    expect(actor.canAdminister).toBe(false);
    expect(actor.db).toBe(authedClient);

    const access = await requireApprovedUser(makeRequest());
    expect(access).toMatchObject({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('blocks banned users even if they hold admin role or scouting admin roster key', async () => {
    profileRow = {
      id: 'u1',
      role: 'admin',
      general_role: 'lead',
      permissions: ['CAN_SEE_ROUTES', 'DATA_SCOUT_ADMIN'],
      banned: true
    };
    rosterRows = [{ key: { key_name: 'Scouting Admin' } }];
    const actor = await actorFor(makeRequest());
    expect(actor.actorId).toBeNull();
    expect(actor.approved).toBe(false);
    expect(actor.canAdminister).toBe(false);
    expect(actor.db).toBe(authedClient);

    const access = await requireApprovedUser(makeRequest());
    expect(access).toMatchObject({ ok: false, status: 403, error: 'Forbidden' });
  });

  it('returns actorId, service-role db, and canAdminister for approved users', async () => {
    rosterRows = [{ key: { key_name: 'Scouting Lead' } }];
    const access = await requireApprovedUser(makeRequest());
    expect(access).toMatchObject({
      ok: true,
      status: 200,
      actorId: 'u1',
      approved: true,
      canAdminister: true
    });
    expect(access.db).toBe(serviceClient);
  });
});

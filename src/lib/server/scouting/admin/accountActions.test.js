import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => ({}) }));
vi.mock('$lib/server/teamSettings.js', () => ({ loadTeamSettings: async () => ({ settings: null, error: null }) }));
vi.mock('$lib/server/integrations/google_sheets_sync.js', () => ({ syncScoutingDataToSheet: vi.fn() }));

const { ADMIN_ACTIONS } = await import('./actions.js');

// A tiny stand-in for the Supabase client: one user_profiles row per id, and the auth admin calls it needs.
function fakeDb(rows) {
  const profiles = new Map(rows.map((row) => [row.id, { ...row }]));
  const updates = [];
  const auth = { admin: { updateUserById: vi.fn(async () => ({ error: null })), signOut: vi.fn(async () => ({})) } };
  const from = () => {
    let patch = null;
    let id = null;
    const builder = {
      select: () => builder,
      update: (value) => ((patch = value), builder),
      eq: (_column, value) => ((id = value), builder),
      maybeSingle: async () => ({ data: profiles.get(id) || null, error: null }),
      single: async () => {
        Object.assign(profiles.get(id), patch);
        updates.push({ id, ...patch });
        return { data: profiles.get(id), error: null };
      },
      then: (resolve) => {
        if (patch) {
          Object.assign(profiles.get(id), patch);
          updates.push({ id, ...patch });
        }
        return resolve({ data: null, error: null });
      }
    };
    return builder;
  };
  return { from, auth, profiles, updates };
}

const run = async (action, ctx) => {
  const response = await ADMIN_ACTIONS[action]({ action, ...ctx });
  return { status: response.status, body: await response.json() };
};

const admin = { id: 'boss', role: 'admin', banned: false };
const scoutingLead = { id: 'lead', role: 'member', roster_keys: ['Scouting Lead'] };
const competitionLead = { id: 'cl', role: 'member', roster_keys: ['Competition Lead'] };

describe('account actions', () => {
  it('approves a pending account and can take approval away, keeping other permissions', async () => {
    const db = fakeDb([{ id: 'new', role: 'member', permissions: ['DATA_SCOUT_MEMBER'] }]);
    const approved = await run('approve-user', {
      db,
      body: { target_user_id: 'new' },
      actorId: 'boss',
      profile: admin
    });
    expect(approved).toMatchObject({ status: 200, body: { success: true } });
    expect(db.profiles.get('new')).toMatchObject({
      general_role: 'member',
      permissions: ['DATA_SCOUT_MEMBER', 'CAN_SEE_ROUTES']
    });
    await run('approve-user', {
      db,
      body: { target_user_id: 'new', approved: false },
      actorId: 'boss',
      profile: admin
    });
    expect(db.profiles.get('new')).toMatchObject({ general_role: 'none', permissions: ['DATA_SCOUT_MEMBER'] });
  });

  it('lets the Competition Lead approve, but not a Scouting Lead', async () => {
    const db = fakeDb([{ id: 'new', role: 'member', permissions: [] }]);
    expect((await run('approve-user', { db, body: { target_user_id: 'new' }, profile: competitionLead })).status).toBe(
      200
    );
    expect((await run('approve-user', { db, body: { target_user_id: 'new' }, profile: scoutingLead })).status).toBe(
      403
    );
  });

  it('never takes approval from an admin or yourself', async () => {
    const db = fakeDb([{ id: 'other-admin', role: 'admin', permissions: [] }]);
    const res = await run('approve-user', {
      db,
      body: { target_user_id: 'other-admin', approved: false },
      actorId: 'boss',
      profile: admin
    });
    expect(res.status).toBe(400);
  });

  it('sets a password and signs the person out everywhere', async () => {
    const db = fakeDb([{ id: 'scout', role: 'member' }]);
    const res = await run('set-user-password', {
      db,
      body: { target_user_id: 'scout', password: 'a-new-password' },
      profile: admin
    });
    expect(res.status).toBe(200);
    expect(db.auth.admin.updateUserById).toHaveBeenCalledWith('scout', { password: 'a-new-password' });
    expect(db.auth.admin.signOut).toHaveBeenCalledWith('scout', 'global');
    const short = await run('set-user-password', {
      db,
      body: { target_user_id: 'scout', password: 'short' },
      profile: admin
    });
    expect(short.status).toBe(400);
  });

  it("does not let a Competition Lead change an admin's password", async () => {
    const db = fakeDb([{ id: 'boss2', role: 'admin' }]);
    const res = await run('set-user-password', {
      db,
      body: { target_user_id: 'boss2', password: 'a-new-password' },
      profile: competitionLead
    });
    expect(res.status).toBe(403);
    expect(db.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('only lets an admin make or remove admins, never themselves', async () => {
    const db = fakeDb([{ id: 'scout', role: 'member', permissions: [] }]);
    expect(
      (await run('set-admin', { db, body: { target_user_id: 'scout', admin: true }, profile: competitionLead })).status
    ).toBe(403);
    expect(
      (await run('set-admin', { db, body: { target_user_id: 'boss', admin: false }, actorId: 'boss', profile: admin }))
        .status
    ).toBe(400);
    const made = await run('set-admin', {
      db,
      body: { target_user_id: 'scout', admin: true },
      actorId: 'boss',
      profile: admin
    });
    expect(made.status).toBe(200);
    expect(db.profiles.get('scout')).toMatchObject({ role: 'admin', permissions: ['CAN_SEE_ROUTES'] });
  });
});

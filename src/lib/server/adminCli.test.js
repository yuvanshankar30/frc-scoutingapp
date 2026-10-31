import { describe, expect, it, vi } from 'vitest';
import { approve, createAdmin, parseArgs, setTeam } from '../../../scripts/admin.mjs';

function fakeDb({ profiles = [], settings = null } = {}) {
  const state = { profiles: profiles.map((p) => ({ ...p })), settings, created: [] };
  const table = (name) => {
    let filter = null;
    let patch = null;
    const builder = {
      select: () => builder,
      ilike: (_c, v) => ((filter = (row) => row.email?.toLowerCase() === String(v).toLowerCase()), builder),
      eq: (_c, v) => {
        filter = (row) => row.id === v;
        if (patch) {
          const row = state.profiles.find(filter);
          if (row) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        }
        return builder;
      },
      maybeSingle: async () =>
        name === 'app_settings'
          ? { data: state.settings, error: null }
          : { data: state.profiles.find(filter) || null, error: null },
      update: (value) => ((patch = value), builder),
      upsert: async (value) => ((state.settings = { ...state.settings, ...value }), { error: null })
    };
    return builder;
  };
  return {
    state,
    from: table,
    auth: {
      admin: {
        createUser: vi.fn(async ({ email }) => {
          const id = `id-${email}`;
          state.profiles.push({ id, email, role: 'member', permissions: [] });
          return { data: { user: { id } }, error: null };
        }),
        updateUserById: vi.fn(async () => ({ error: null }))
      }
    }
  };
}

describe('npm run admin', () => {
  it('parses commands and --flags', () => {
    expect(parseArgs(['set-team', '--number', '1234', '--name=Robo Raptors', '--sign-up', 'off'])).toEqual({
      command: 'set-team',
      options: { number: '1234', name: 'Robo Raptors', 'sign-up': 'off' }
    });
  });

  it('creates the first admin, approved, and promotes an existing account', async () => {
    const db = fakeDb();
    const result = await createAdmin(db, { email: 'Admin@Example.org', password: 'long-password', name: 'Ada' });
    expect(result).toMatchObject({ email: 'admin@example.org', created: true });
    expect(db.state.profiles[0]).toMatchObject({ role: 'admin', permissions: ['CAN_SEE_ROUTES'], full_name: 'Ada' });
    await expect(createAdmin(fakeDb(), { email: 'a@b.co', password: 'short' })).rejects.toThrow(/8 characters/);
  });

  it('sets the team settings through the same checks as the Team settings tab', async () => {
    const db = fakeDb({ settings: { id: 1, team_number: null, team_name: '' } });
    const value = await setTeam(db, { number: '1234', name: 'Robo Raptors', color: '#DC2626', timezone: 'UTC' });
    expect(value).toMatchObject({ team_number: 1234, team_name: 'Robo Raptors', brand_color: '#dc2626' });
    expect(db.state.settings).toMatchObject({ team_number: 1234 });
    await expect(setTeam(db, { number: 'abc' })).rejects.toThrow(/team number/);
  });

  it('approves an account by email', async () => {
    const db = fakeDb({ profiles: [{ id: 'u1', email: 'scout@example.org', permissions: [] }] });
    await approve(db, { email: 'scout@example.org' });
    expect(db.state.profiles[0]).toMatchObject({ general_role: 'member', permissions: ['CAN_SEE_ROUTES'] });
    await expect(approve(db, { email: 'nobody@example.org' })).rejects.toThrow(/No account/);
  });
});

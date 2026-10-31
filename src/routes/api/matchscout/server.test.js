import { beforeEach, describe, expect, it, vi } from 'vitest';

let actor;
let writes;
let entries;
let filters;
let profiles;
let problems;
let rosterRows;
const { notifyPitProblem } = vi.hoisted(() => ({ notifyPitProblem: vi.fn() }));
const chain = (table) => {
  let data =
    table === 'scouting_settings'
      ? { start_position_photos: { 'red:center': 'match-starts/photo.jpg' } }
      : table === 'user_profiles'
        ? profiles
        : table === 'pit_problem_reports'
          ? problems
          : table === 'roster_entries'
            ? rosterRows
            : table === 'match_scout_entries'
              ? entries
              : null;
  const query = {
    select: () => query,
    eq: (field, value) => {
      filters.push({ table, field, value });
      if (Array.isArray(data)) data = data.filter((row) => row[field] === undefined || row[field] === value);
      return query;
    },
    in: () => query,
    order: () => query,
    ilike: () => query,
    upsert: (value) => {
      writes.push(value);
      data = value;
      return query;
    },
    insert: (value) => {
      writes.push(value);
      data = { id: 'problem-1', ...value };
      return query;
    },
    update: (value) => {
      writes.push(value);
      const base = Array.isArray(data) ? data[0] : data;
      data = { ...(base || {}), ...value };
      return query;
    },
    delete: () => {
      writes.push({ deleted: true });
      return query;
    },
    limit: () => query,
    single: async () => ({ data: Array.isArray(data) ? data[0] || null : data, error: null }),
    maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] || null : data, error: null }),
    then: (resolve) => Promise.resolve({ data, error: null }).then(resolve)
  };
  return query;
};
const client = {
  auth: { getUser: async () => ({ data: { user: actor } }) },
  from: chain,
  storage: {
    from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/photo' }, error: null }) })
  }
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => client }));
vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => client }));
vi.mock('$lib/server/integrations/pit_problem_notifications.js', () => ({ notifyPitProblem }));
const { GET, POST } = await import('./+server.js');
const request = (body) => ({ headers: { get: () => 'Bearer test' }, json: async () => body });
const valid = {
  action: 'save-entry',
  event_key: '2026test',
  match_key: 'qm1',
  team_key: '5940',
  starting_position: 'center',
  scout_name: 'Actual Scout',
  preload: true,
  teleop_roles: ['Scorer'],
  balls_scored_band: '123',
  ratings: { BPS: 3 },
  ratings_unknown: ['Shot accuracy'],
  significant_crash: false,
  teleop_robot_status: 'active',
  mechanical_break: false
};

describe('match scouting route v2', () => {
  beforeEach(() => {
    actor = { id: 'scout', email: 'scout@example.test' };
    profiles = [
      {
        id: 'scout',
        full_name: 'Account Name',
        role: 'member',
        general_role: 'member',
        permissions: ['CAN_SEE_ROUTES'],
        banned: false
      }
    ];
    problems = null;
    rosterRows = [];
    writes = [];
    entries = [];
    filters = [];
    notifyPitProblem.mockReset().mockResolvedValue({ ok: true, channel: 'CPIT', ts: '123.4' });
  });
  it('requires authentication for photos and reports', async () => {
    actor = null;
    expect(
      (await GET({ request: request(), url: new URL('https://test/api/matchscout?resource=start-photos') })).status
    ).toBe(401);
    expect((await POST({ request: request(valid) })).status).toBe(401);
    expect(writes).toEqual([]);
  });
  it('does not allow omitting form_version to bypass required answers', async () => {
    expect(
      (
        await POST({
          request: request({ action: 'save-entry', event_key: '2026test', match_key: 'qm1', team_key: '5940' })
        })
      ).status
    ).toBe(400);
    expect(writes).toEqual([]);
  });
  it('saves typed counts and explicit unknowns without sending email or notifications', async () => {
    expect((await POST({ request: request(valid) })).status).toBe(200);
    expect(writes[0]).toMatchObject({ form_version: 2, balls_scored_average: 123, ratings_unknown: ['Shot accuracy'] });
  });
  it('saves a post-match beached observation', async () => {
    expect((await POST({ request: request({ ...valid, beached: true }) })).status).toBe(200);
    expect(writes[0]).toMatchObject({ beached: true });
  });
  it('blocks mechanical breaks and dead robots before saving without a pit problem summary', async () => {
    for (const extra of [{ mechanical_break: true }, { teleop_robot_status: 'dead' }]) {
      expect((await POST({ request: request({ ...valid, ...extra }) })).status).toBe(400);
    }
    expect(writes).toEqual([]);
  });
  it('sends a saved mechanical issue to the pit problems Slack channel and records its delivery', async () => {
    const response = await POST({
      request: request({
        ...valid,
        mechanical_break: true,
        report_pit_problem: true,
        pit_problem_summary: 'Left gearbox failed',
        pit_problem_detail: 'Robot stopped during teleop'
      })
    });
    expect(response.status).toBe(200);
    expect((await response.clone().json()).pit_notification).toEqual({ ok: true, channel: 'CPIT', ts: '123.4' });
    expect(notifyPitProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'problem-1',
        event_key: '2026test',
        team_key: 'frc5940',
        summary: 'Left gearbox failed'
      }),
      'Actual Scout'
    );
    expect(writes).toContainEqual(
      expect.objectContaining({
        slack_channel: 'CPIT',
        slack_ts: '123.4'
      })
    );
  });
  it('limits My reports to the verified scout, ignoring caller-supplied ownership', async () => {
    entries = [
      { id: 'own', created_by: 'scout' },
      { id: 'other', created_by: 'another-scout' }
    ];
    const response = await GET({
      request: request(),
      url: new URL('https://test/api/matchscout?event_key=2026test&mine=1&created_by=another-scout')
    });
    expect((await response.json()).data.map((row) => row.id)).toEqual(['own']);
    expect(filters).toContainEqual({ table: 'match_scout_entries', field: 'created_by', value: 'scout' });
  });
  it('attributes corrections to the verified scout and uses the existing report key', async () => {
    await POST({ request: request({ ...valid, created_by: 'another-scout', teleop_notes: 'Corrected observation' }) });
    expect(writes[0]).toMatchObject({
      created_by: 'scout',
      event_key: '2026test',
      match_key: '2026test_qm1',
      match_label: 'qm1',
      team_key: 'frc5940',
      teleop_notes: 'Corrected observation'
    });
  });
  it('returns signed photo URLs and keeps the original report scout name', async () => {
    const photoResponse = await GET({
      request: request(),
      url: new URL('https://test/api/matchscout?resource=start-photos')
    });
    expect((await photoResponse.json()).data['red:center']).toBe('https://example.test/photo');
    entries = [{ created_by: 'scout', scout_name: 'Original Scout' }];
    const reportResponse = await GET({
      request: request(),
      url: new URL('https://test/api/matchscout?event_key=2026test')
    });
    expect((await reportResponse.json()).data[0].scout_name).toBe('Original Scout');
  });
  it('blocks unapproved and banned users from reading or writing match scouting data', async () => {
    profiles = [
      {
        id: 'scout',
        full_name: 'Unapproved User',
        role: 'member',
        general_role: 'none',
        permissions: [],
        banned: false
      }
    ];
    expect(
      (await GET({ request: request(), url: new URL('https://test/api/matchscout?event_key=2026test') })).status
    ).toBe(403);
    expect(
      (
        await GET({
          request: request(),
          url: new URL('https://test/api/matchscout?resource=power-rankings&event_key=2026test')
        })
      ).status
    ).toBe(403);
    expect((await POST({ request: request(valid) })).status).toBe(403);
    expect(writes).toEqual([]);

    profiles = [
      {
        id: 'scout',
        full_name: 'Banned Admin',
        role: 'admin',
        general_role: 'lead',
        permissions: ['CAN_SEE_ROUTES', 'DATA_SCOUT_ADMIN'],
        banned: true
      }
    ];
    expect(
      (await GET({ request: request(), url: new URL('https://test/api/matchscout?event_key=2026test') })).status
    ).toBe(403);
    expect((await POST({ request: request({ action: 'delete-entry', id: 'entry-1' }) })).status).toBe(403);
    expect(writes).toEqual([]);
  });
  it('enforces ownership or scouting-admin role on resolve-pit-problem and strips Slack delivery metadata on GET', async () => {
    problems = [
      {
        id: 'prob-1',
        event_key: '2026test',
        team_key: 'frc5940',
        match_key: 'qm1',
        created_by: 'other-scout',
        scout_observations: [{ scout_id: 'other-scout', summary: 'Gearbox issue' }],
        resolved: false,
        slack_channel: 'CPIT',
        slack_ts: '123.4',
        slack_last_payload: { text: 'internal' }
      }
    ];

    const listRes = await GET({
      request: request(),
      url: new URL('https://test/api/matchscout?resource=pit-problems&event_key=2026test')
    });
    expect(listRes.status).toBe(200);
    const listRow = (await listRes.json()).data[0];
    expect(listRow.id).toBe('prob-1');
    expect(listRow.slack_channel).toBeUndefined();
    expect(listRow.slack_ts).toBeUndefined();
    expect(listRow.slack_last_payload).toBeUndefined();

    // Non-owner regular scout cannot resolve another scout's pit problem
    const denied = await POST({ request: request({ action: 'resolve-pit-problem', id: 'prob-1', resolved: true }) });
    expect(denied.status).toBe(403);
    expect(writes).toEqual([]);

    // Report creator can resolve their own pit problem
    problems[0].created_by = 'scout';
    const ownerRes = await POST({ request: request({ action: 'resolve-pit-problem', id: 'prob-1', resolved: true }) });
    expect(ownerRes.status).toBe(200);

    // Scouting admin can resolve any pit problem
    writes = [];
    problems[0].created_by = 'other-scout';
    rosterRows = [{ key: { key_name: 'Scouting Lead' } }];
    const adminRes = await POST({ request: request({ action: 'resolve-pit-problem', id: 'prob-1', resolved: true }) });
    expect(adminRes.status).toBe(200);
  });
});

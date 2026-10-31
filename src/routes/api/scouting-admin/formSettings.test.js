import { beforeEach, describe, expect, it, vi } from 'vitest';

let actor;
let actorProfile;
let targetProfile;
let actorRosterRows;
let writes;
let deletes;
let inserts;
let removedStoragePaths;
let files;
let signOutCalls;

const chain = (table) => {
  let isDelete = false;
  let data =
    table === 'user_profiles'
      ? actorProfile
      : table === 'roster_entries'
        ? actorRosterRows
        : table === 'pit_scout_entries'
          ? [
              {
                id: 'pit-1',
                event_key: '2026caav',
                team_key: 'frc254',
                photo_paths: ['2026caav/frc254/robot.jpg', 'match-starts/keep-me.jpg']
              }
            ]
          : table === 'scout_data_events' || table === 'scout_notes' || table === 'scout_match_assignments'
            ? [{ id: `${table}-1`, match_key: '2026caav_qm1', team_key: 'frc254' }]
            : table === 'rosters'
              ? [{ id: 'roster-1', name: 'Scouting' }]
              : table === 'roster_keys'
                ? [
                    { id: 'key-sl', roster_id: 'roster-1', key_name: 'Scouting Lead' },
                    { id: 'key-ds', roster_id: 'roster-1', key_name: 'Data Scout Member' }
                  ]
                : table === 'match_scout_entries'
                  ? [
                      {
                        id: 'r1',
                        match_key: '2026caav_qm1',
                        team_key: 'frc1234',
                        created_by: 'admin',
                        scout_name: 'Typed Student'
                      },
                      { id: 'r2', match_key: '2026caav_qm2', team_key: 'frc254', created_by: 'admin', scout_name: '' }
                    ]
                  : { event_key: '2026caav', start_position_photos: { 'blue:center': 'match-starts/old.jpg' } };

  const query = {
    select: () => query,
    order: () => query,
    in: () => query,
    eq: (col, val) => {
      if (table === 'user_profiles' && col === 'id' && val !== actor?.id) {
        data = targetProfile;
      }
      if (isDelete) {
        deletes.push({ table, filter: ['eq', col, val] });
      }
      return query;
    },
    ilike: (col, val) => {
      if (isDelete) {
        deletes.push({ table, filter: ['ilike', col, val] });
      }
      return query;
    },
    delete: () => {
      isDelete = true;
      return query;
    },
    insert: (value) => {
      inserts.push({ table, value });
      data = value;
      return query;
    },
    update: (value) => {
      writes.push(value);
      data = { ...(data || {}), ...value };
      return query;
    },
    upsert: (value) => {
      writes.push(value);
      data = value;
      return query;
    },
    single: async () => ({ data, error: null }),
    maybeSingle: async () => ({ data, error: null }),
    then: (resolve) => Promise.resolve({ data, error: null }).then(resolve)
  };
  return query;
};

const client = {
  auth: {
    getUser: async () => ({ data: { user: actor } }),
    admin: {
      signOut: async (userId, scope) => {
        signOutCalls.push({ userId, scope });
        return { error: null };
      }
    }
  },
  from: chain,
  storage: {
    from: () => ({
      list: async () => ({ data: files, error: null }),
      createSignedUploadUrl: async (path) => ({ data: { path, token: 'test' }, error: null }),
      remove: async (paths) => {
        removedStoragePaths.push(...paths);
        return { data: paths, error: null };
      }
    })
  }
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => client }));
vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => client }));
vi.mock('$lib/server/teamSettings.js', () => ({
  loadTeamSettings: async () => ({ settings: { teamNumber: 1234, otherTeamNumbers: [5678] }, error: null })
}));
vi.mock('$lib/server/integrations/google_sheets_sync.js', () => ({ syncScoutingDataToSheet: vi.fn() }));
const { GET, POST } = await import('./+server.js');
const post = (body) => POST({ request: { headers: { get: () => 'Bearer test' }, json: async () => body } });

describe('scouting admin names, starting photos, and security guards', () => {
  beforeEach(() => {
    actor = { id: 'admin' };
    actorProfile = { id: 'admin', role: 'admin', banned: false, is_dev: false };
    targetProfile = { id: 'scout', role: 'member', banned: false, is_dev: false, frc_team: '1234' };
    actorRosterRows = [];
    writes = [];
    deletes = [];
    inserts = [];
    removedStoragePaths = [];
    files = [];
    signOutCalls = [];
  });

  it('rejects unauthenticated, non-admin, and banned mutations (COMP-05)', async () => {
    actor = null;
    expect((await post({ action: 'update-scout-name' })).status).toBe(401);
    actor = { id: 'member' };
    actorProfile = { id: 'member', role: 'member', banned: false };
    expect((await post({ action: 'create-start-photo-upload' })).status).toBe(403);
    // Banned admin must also be rejected
    actor = { id: 'admin' };
    actorProfile = { id: 'admin', role: 'admin', banned: true };
    expect((await post({ action: 'update-scout-name', target_user_id: 'scout', full_name: 'Valid Name' })).status).toBe(
      403
    );
    expect(writes).toEqual([]);
  });

  it('updates only the name and refuses email placeholders', async () => {
    expect(
      (await post({ action: 'update-scout-name', target_user_id: 'scout', full_name: 'test@example.com' })).status
    ).toBe(400);
    expect(
      (await post({ action: 'update-scout-name', target_user_id: 'scout', full_name: ' Actual Scout ' })).status
    ).toBe(200);
    expect(writes).toEqual([{ full_name: 'Actual Scout' }]);
  });

  it('limits signed uploads to supported images and 5 MiB', async () => {
    for (const extra of [
      { content_type: 'text/html', size: 100 },
      { content_type: 'image/png', size: 5242881 }
    ]) {
      expect((await post({ action: 'create-start-photo-upload', ...extra })).status).toBe(400);
    }
    const response = await post({ action: 'create-start-photo-upload', content_type: 'image/png', size: 100 });
    expect(response.status).toBe(200);
    expect((await response.json()).data.path).toMatch(/^match-starts\/[a-f0-9-]+\.png$/);
  });

  it('requires an uploaded file and preserves other starting positions', async () => {
    const body = { action: 'save-start-photo', alliance: 'red', position: 'center', path: 'match-starts/abc.jpg' };
    expect((await post(body)).status).toBe(400);
    files = [{ name: 'abc.jpg', metadata: { size: 100 } }];
    expect((await post(body)).status).toBe(200);
    expect(writes[0].start_position_photos).toEqual({ 'blue:center': 'match-starts/old.jpg', 'red:center': body.path });
  });

  it('scopes delete-all-scouting-data to one event, requires full admin, writes a backup snapshot, and preserves match-starts/* photos (COMP-08)', async () => {
    // A Scouting Lead (scouting admin, not Competition Lead) cannot wipe data
    actor = { id: 'student-lead' };
    actorProfile = { id: 'student-lead', role: 'member', banned: false };
    actorRosterRows = [{ key: { key_name: 'Scouting Lead' } }];
    expect((await post({ action: 'delete-all-scouting-data', event_key: '2026caav' })).status).toBe(403);

    // Full admin with invalid event_key gets 400
    actor = { id: 'admin' };
    actorProfile = { id: 'admin', role: 'admin', banned: false };
    expect((await post({ action: 'delete-all-scouting-data', event_key: 'invalid!' })).status).toBe(400);

    // Full admin with valid event_key scopes all deletes to 2026caav, writes activity_log backup, and excludes match-starts/*
    const res = await post({ action: 'delete-all-scouting-data', event_key: '2026caav' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.event_key).toBe('2026caav');
    expect(json.data.backup_recorded).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('activity_log');
    expect(inserts[0].value[0].action).toBe('BACKUP_BEFORE_DELETE_ALL_SCOUTING_DATA');
    expect(deletes).toEqual(
      expect.arrayContaining([
        { table: 'scout_data_events', filter: ['ilike', 'match_key', '2026caav\\_%'] },
        { table: 'scout_notes', filter: ['ilike', 'match_key', '2026caav\\_%'] },
        { table: 'scout_match_assignments', filter: ['ilike', 'match_key', '2026caav\\_%'] },
        { table: 'pit_scout_entries', filter: ['eq', 'event_key', '2026caav'] }
      ])
    );
    expect(removedStoragePaths).toEqual(['2026caav/frc254/robot.jpg']);
    expect(removedStoragePaths).not.toContain('match-starts/keep-me.jpg');
  });

  it('blocks leads other than Competition Lead from granting lead roles or Mentor affiliation (COMP-10 / AUTHZ-09)', async () => {
    actor = { id: 'student-lead' };
    actorProfile = { id: 'student-lead', role: 'member', banned: false };
    actorRosterRows = [{ key: { key_name: 'Pit Lead' } }];
    targetProfile = { ...targetProfile, frc_team: '1234' };

    const promoteRes = await post({
      action: 'update-competition-roles',
      target_user_id: 'scout',
      competition_roles: ['Scouting Lead'],
      frc_team: '1234'
    });
    expect(promoteRes.status).toBe(403);

    const mentorRes = await post({
      action: 'update-competition-roles',
      target_user_id: 'scout',
      competition_roles: ['Data Scout Member'],
      frc_team: 'Mentor'
    });
    expect(mentorRes.status).toBe(403);

    const retiredRes = await post({
      action: 'update-competition-roles',
      target_user_id: 'scout',
      competition_roles: ['Scouting Admin'],
      frc_team: '1234'
    });
    expect(retiredRes.status).toBe(400);
  });

  it('lets a Competition Lead grant several roles and another team without touching the profile team', async () => {
    actor = { id: 'comp-lead' };
    actorProfile = { id: 'comp-lead', role: 'member', banned: false };
    actorRosterRows = [{ key: { key_name: 'Competition Lead' } }];
    targetProfile = { ...targetProfile, frc_team: '1234' };

    const res = await post({
      action: 'update-competition-roles',
      target_user_id: 'scout',
      competition_roles: ['Data Scout Member', 'Scouting Lead'],
      frc_team: '5678'
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.competition_roles).toEqual(['Scouting Lead', 'Data Scout Member']);
    expect(body.data.frc_team).toBe('5678');
    const rosterInsert = inserts.find((entry) => entry.table === 'roster_entries');
    expect(rosterInsert.value.map((row) => row.key_id)).toEqual(['key-sl', 'key-ds']);
    expect(writes).toEqual([expect.objectContaining({ user_id: 'scout', frc_team: '5678', updated_by: 'comp-lead' })]);
  });

  it('allows full admin to ban and globally revoke sessions for a lost phone (COMP-05)', async () => {
    const res = await post({ action: 'ban-and-revoke-user', target_user_id: 'scout' });
    expect(res.status).toBe(200);
    expect(writes).toEqual([{ banned: true }]);
    expect(signOutCalls).toEqual([{ userId: 'scout', scope: 'global' }]);
  });

  it('preserves typed scout_name on match_reports in GET /api/scouting-admin (COMP-11)', async () => {
    // When user_profiles is queried as a list in GET, return an array of users
    const origFrom = client.from;
    client.from = (table) => {
      const q = origFrom(table);
      if (table === 'user_profiles') {
        q.order = () =>
          Promise.resolve({
            data: [
              { id: 'admin', full_name: 'Mentor Account', email: 'mentor@example.org', role: 'admin', banned: false }
            ],
            error: null
          });
      }
      return q;
    };
    try {
      const res = await GET({
        request: { headers: { get: () => 'Bearer test' } },
        url: new URL('http://localhost/api/scouting-admin')
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.match_reports).toEqual([
        expect.objectContaining({ id: 'r1', scout_name: 'Typed Student' }),
        expect.objectContaining({ id: 'r2', scout_name: 'Mentor Account' })
      ]);
    } finally {
      client.from = origFrom;
    }
  });
});

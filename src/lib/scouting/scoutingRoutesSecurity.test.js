import { beforeEach, describe, expect, it, vi } from 'vitest';

let actor = null;
let profileRow = null;
let rosterRows = [];
let settingsRow = { id: 1, event_key: '2026cc' };
let tableRows = {};
let recordedFilters = [];
let recordedLimits = [];
let recordedRanges = [];
let recordedWrites = [];

function resetState() {
  actor = { id: 'user-approved', email: 'scout@example.test' };
  profileRow = {
    id: 'user-approved',
    role: 'member',
    general_role: 'member',
    purchasing_role: 'basic',
    team_role: 'Other',
    permissions: ['CAN_SEE_ROUTES'],
    banned: false
  };
  rosterRows = [];
  settingsRow = { id: 1, event_key: '2026cc' };
  tableRows = {
    scouting_picklist: [
      {
        id: 'pick-1',
        event_key: '2026cc',
        team_key: 'frc5940',
        team_number: 5940,
        position: 0,
        note: 'Our robot',
        updated_at: '2026-10-16T10:00:00.000Z'
      },
      {
        id: 'pick-other',
        event_key: '2026mttd',
        team_key: 'frc254',
        team_number: 254,
        position: 0,
        note: 'Other event',
        updated_at: '2026-10-16T10:00:00.000Z'
      }
    ],
    scout_notes: [
      {
        id: 'note-1',
        match_key: '2026cc_qm1',
        team_key: 'frc5940',
        notes: 'Fast cycle',
        ranking_impact: 1,
        created_by: 'user-approved',
        created_at: '2026-10-16T10:00:00.000Z'
      }
    ],
    pit_scout_entries: [
      {
        id: 'pit-1',
        event_key: '2026cc',
        team_key: 'frc5940',
        drivebase_type: 'Swerve',
        shooter_type: 'Turret',
        hopper_type: 'Spindex',
        scout_name: 'Alice',
        photo_paths: ['2026cc/frc5940/photo1.jpg'],
        technical_details: { pit_contact_phone: '555-0199' },
        updated_at: '2026-10-16T12:00:00.000Z'
      }
    ],
    scout_data_events: [
      {
        id: 'evt-own',
        match_key: '2026cc_qm1',
        team_key: 'frc5940',
        event_type: 'quick_defense_start',
        event_value: '1',
        role: null,
        created_by: 'user-approved',
        created_at: '2026-10-16T10:00:00.000Z'
      },
      {
        id: 'evt-vision',
        match_key: '2026cc_qm1',
        team_key: 'frc5940',
        event_type: 'hub_fuel_override',
        event_value: '42',
        role: 'vision',
        created_by: 'user-approved',
        created_at: '2026-10-16T10:01:00.000Z'
      }
    ],
    scouting_form_versions: []
  };
  recordedFilters = [];
  recordedLimits = [];
  recordedRanges = [];
  recordedWrites = [];
}

function makeQuery(table) {
  let op = 'select';
  let eqFilters = [];
  let ilikeFilters = [];
  let writePayload = null;

  const evaluateRows = () => {
    if (table === 'user_profiles') {
      return profileRow ? [profileRow] : [];
    }
    if (table === 'roster_entries') {
      return rosterRows;
    }
    if (table === 'scouting_settings') {
      return settingsRow ? [settingsRow] : [];
    }
    let rows = [...(tableRows[table] || [])];
    for (const f of eqFilters) {
      rows = rows.filter((r) => r?.[f.field] === f.value);
    }
    for (const f of ilikeFilters) {
      const prefix = String(f.pattern).replace(/\\_/g, '_').replace(/%$/, '').toLowerCase();
      rows = rows.filter((r) =>
        String(r?.[f.field] || '')
          .toLowerCase()
          .startsWith(prefix)
      );
    }
    return rows;
  };

  const execute = () => {
    if (op === 'insert') {
      const inserted = Array.isArray(writePayload) ? writePayload[0] : writePayload;
      const row = { id: 'new-id', ...inserted };
      tableRows[table] = [...(tableRows[table] || []), row];
      return { data: [row], error: null };
    }
    if (op === 'upsert') {
      const upserted = Array.isArray(writePayload) ? writePayload[0] : writePayload;
      const row = { id: 'upserted-id', ...upserted };
      return { data: [row], error: null };
    }
    if (op === 'update') {
      const matched = evaluateRows();
      const updated = matched.map((r) => ({ ...r, ...writePayload }));
      return { data: updated, error: null };
    }
    if (op === 'delete') {
      const matched = evaluateRows();
      const matchedIds = new Set(matched.map((r) => r.id));
      tableRows[table] = (tableRows[table] || []).filter((r) => !matchedIds.has(r.id));
      return { data: matched, error: null };
    }
    return { data: evaluateRows(), error: null };
  };

  const builder = {
    select: () => builder,
    insert: (val) => {
      op = 'insert';
      writePayload = val;
      recordedWrites.push({ table, op: 'insert', val });
      return builder;
    },
    upsert: (val) => {
      op = 'upsert';
      writePayload = val;
      recordedWrites.push({ table, op: 'upsert', val });
      return builder;
    },
    update: (val) => {
      op = 'update';
      writePayload = val;
      recordedWrites.push({ table, op: 'update', val, eqFilters });
      return builder;
    },
    delete: () => {
      op = 'delete';
      recordedWrites.push({ table, op: 'delete', eqFilters });
      return builder;
    },
    eq: (field, value) => {
      eqFilters.push({ field, value });
      recordedFilters.push({ table, type: 'eq', field, value });
      return builder;
    },
    ilike: (field, pattern) => {
      ilikeFilters.push({ field, pattern });
      recordedFilters.push({ table, type: 'ilike', field, pattern });
      return builder;
    },
    not: () => builder,
    order: () => builder,
    limit: (n) => {
      recordedLimits.push({ table, limit: n });
      return builder;
    },
    range: (from, to) => {
      recordedRanges.push({ table, from, to });
      const res = execute();
      const sliced = (res.data || []).slice(from, to + 1);
      return Promise.resolve({ data: sliced, error: null });
    },
    single: async () => {
      const res = execute();
      return { data: res.data?.[0] ?? null, error: res.error };
    },
    maybeSingle: async () => {
      const res = execute();
      return { data: res.data?.[0] ?? null, error: res.error };
    },
    then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject)
  };

  return builder;
}

const mockClient = {
  auth: {
    getUser: async () => ({ data: { user: actor } })
  },
  from: (table) => makeQuery(table)
};

vi.mock('@supabase/supabase-js', () => ({ createClient: () => mockClient }));
vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => mockClient }));

const picklistRoute = await import('../../routes/api/scouting-picklist/+server.js');
const flagMoveRoute = await import('../../routes/api/scouting-picklist/flag-move/+server.js');
const notescoutRoute = await import('../../routes/notescout/+server.js');
const pitscoutRoute = await import('../../routes/pitscout/+server.js');
const datascoutRoute = await import('../../routes/datascout/+server.js');

const makeReq = (body = null) => ({
  headers: { get: () => (actor ? 'Bearer test-jwt' : '') },
  json: async () => body
});

describe('Security fixes across scouting data routes (F2a)', () => {
  beforeEach(() => {
    resetState();
  });

  describe('/api/scouting-picklist & /api/scouting-picklist/flag-move', () => {
    it('blocks anonymous GET and POST requests with 401 (AUTHZ-03 / CRITICAL-01)', async () => {
      actor = null;
      const getRes = await picklistRoute.GET({
        url: new URL('https://test/api/scouting-picklist?event_key=2026cc'),
        request: makeReq()
      });
      expect(getRes.status).toBe(401);

      const postRes = await picklistRoute.POST({
        request: makeReq({ action: 'add', event_key: '2026cc', team_key: 'frc5940' })
      });
      expect(postRes.status).toBe(401);

      const flagRes = await flagMoveRoute.POST({
        request: makeReq({ movedTeam: { teamNumber: 5940 } })
      });
      expect(flagRes.status).toBe(401);
    });

    it('blocks unapproved self-registered users and banned users with 403 (AUTHZ-04 / COMP-05)', async () => {
      profileRow = { id: 'user-approved', role: 'member', general_role: 'none', permissions: [], banned: false };
      expect(
        (
          await picklistRoute.GET({
            url: new URL('https://test/api/scouting-picklist?event_key=2026cc'),
            request: makeReq()
          })
        ).status
      ).toBe(403);
      expect(
        (
          await picklistRoute.POST({
            request: makeReq({ action: 'remove', id: 'pick-1', event_key: '2026cc' })
          })
        ).status
      ).toBe(403);
      expect(
        (
          await flagMoveRoute.POST({
            request: makeReq({ movedTeam: { teamNumber: 5940 } })
          })
        ).status
      ).toBe(403);

      // Banned admin/approved user is also blocked
      profileRow = {
        id: 'user-approved',
        role: 'admin',
        general_role: 'lead',
        permissions: ['CAN_SEE_ROUTES'],
        banned: true
      };
      expect(
        (
          await picklistRoute.GET({
            url: new URL('https://test/api/scouting-picklist?event_key=2026cc'),
            request: makeReq()
          })
        ).status
      ).toBe(403);
      expect(
        (
          await picklistRoute.POST({
            request: makeReq({ action: 'note', id: 'pick-1', event_key: '2026cc', note: 'sabotage' })
          })
        ).status
      ).toBe(403);
    });

    it('scopes remove and note to event_key, preventing cross-event IDOR (AUTHZ-04)', async () => {
      // Attempting to remove or note pick-other (from 2026mttd) while targeting 2026cc returns 404
      const removeCrossEvent = await picklistRoute.POST({
        request: makeReq({ action: 'remove', id: 'pick-other', event_key: '2026cc' })
      });
      expect(removeCrossEvent.status).toBe(404);
      expect(tableRows.scouting_picklist.find((r) => r.id === 'pick-other')).toBeTruthy();

      const noteCrossEvent = await picklistRoute.POST({
        request: makeReq({ action: 'note', id: 'pick-other', event_key: '2026cc', note: 'hijack' })
      });
      expect(noteCrossEvent.status).toBe(404);

      // Same-event update succeeds and sets private Cache-Control
      const noteSameEvent = await picklistRoute.POST({
        request: makeReq({ action: 'note', id: 'pick-1', event_key: '2026cc', note: 'Updated note' })
      });
      expect(noteSameEvent.status).toBe(200);
      expect(noteSameEvent.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('rejects stale delayed offline reorder with 409 Conflict (COMP-07)', async () => {
      const staleReorder = await picklistRoute.POST({
        request: makeReq({
          action: 'reorder',
          event_key: '2026cc',
          ordered_ids: ['pick-1'],
          client_submitted_at: '2026-10-16T09:00:00.000Z' // older than pick-1 updated_at (10:00:00Z)
        })
      });
      expect(staleReorder.status).toBe(409);
    });
  });

  describe('/notescout', () => {
    it('blocks anonymous and unapproved/banned reads & writes (AUTHZ-03 / CRITICAL-03)', async () => {
      actor = null;
      for (const query of [
        '?list_teams=1&event_key=2026cc',
        '?team_key=frc5940&event_key=2026cc',
        '?recent=10&event_key=2026cc'
      ]) {
        const res = await notescoutRoute.GET({ url: new URL(`https://test/notescout${query}`), request: makeReq() });
        expect(res.status).toBe(401);
      }

      actor = { id: 'u2' };
      profileRow = { id: 'u2', role: 'member', general_role: 'none', permissions: [], banned: false };
      expect(
        (
          await notescoutRoute.GET({
            url: new URL('https://test/notescout?team_key=frc5940&event_key=2026cc'),
            request: makeReq()
          })
        ).status
      ).toBe(403);
      expect(
        (
          await notescoutRoute.POST({
            request: makeReq({ action: 'save-note', match_key: '2026cc_qm1', team_key: 'frc5940', notes: 'test' })
          })
        ).status
      ).toBe(403);
    });

    it('rejects wildcard event_key injection and escapes underscore in match_key prefix (INJ-02 & ABUSE-05)', async () => {
      const badEventRes = await notescoutRoute.GET({
        url: new URL('https://test/notescout?event_key=%25&team_key=frc5940'),
        request: makeReq()
      });
      expect(badEventRes.status).toBe(400);

      const goodRes = await notescoutRoute.GET({
        url: new URL('https://test/notescout?event_key=2026cc&recent=50000'),
        request: makeReq()
      });
      expect(goodRes.status).toBe(200);
      expect(recordedFilters).toContainEqual({
        table: 'scout_notes',
        type: 'ilike',
        field: 'match_key',
        pattern: '2026cc\\_%'
      });
      expect(recordedLimits).toContainEqual({ table: 'scout_notes', limit: 1000 });
    });
  });

  describe('/pitscout', () => {
    it('blocks anonymous and unapproved/banned access to pit profiles and phone numbers (AUTHZ-03 / CRITICAL-03)', async () => {
      actor = null;
      expect(
        (await pitscoutRoute.GET({ url: new URL('https://test/pitscout?event_key=2026cc'), request: makeReq() })).status
      ).toBe(401);
      expect(
        (await pitscoutRoute.GET({ url: new URL('https://test/pitscout?resource=pit-contacts'), request: makeReq() }))
          .status
      ).toBe(401);

      actor = { id: 'u2' };
      profileRow = { id: 'u2', role: 'admin', general_role: 'lead', permissions: ['CAN_SEE_ROUTES'], banned: true };
      expect(
        (await pitscoutRoute.GET({ url: new URL('https://test/pitscout?event_key=2026cc'), request: makeReq() })).status
      ).toBe(403);
      expect(
        (
          await pitscoutRoute.POST({
            request: makeReq({ action: 'save-entry', event_key: '2026cc', team_key: 'frc5940' })
          })
        ).status
      ).toBe(403);
    });

    it('caps recent queries, scopes by event_key, sanitizes photo_paths, and preserves newer fields on stale offline replay (ABUSE-05 / COMP-07)', async () => {
      const recentRes = await pitscoutRoute.GET({
        url: new URL('https://test/pitscout?recent=999999'),
        request: makeReq()
      });
      expect(recentRes.status).toBe(200);
      expect(recordedFilters).toContainEqual({
        table: 'pit_scout_entries',
        type: 'eq',
        field: 'event_key',
        value: '2026cc'
      });
      expect(recordedLimits).toContainEqual({ table: 'pit_scout_entries', limit: 250 });

      // Stale offline save-entry sanitizes unsafe photo_paths and preserves existing photo_paths & newer drivebase_type
      const saveRes = await pitscoutRoute.POST({
        request: makeReq({
          action: 'save-entry',
          event_key: '2026cc',
          team_key: 'frc5940',
          drivebase_type: 'Tank',
          additional_notes: 'Offline note',
          photo_paths: ['../secret.jpg', '/abs/path.jpg', 'match-starts/red.jpg'],
          client_submitted_at: '2026-10-16T11:00:00.000Z' // older than existing 12:00:00Z
        })
      });
      expect(saveRes.status).toBe(200);
      const body = await saveRes.json();
      expect(body.data.photo_paths).toEqual(['2026cc/frc5940/photo1.jpg']);
      expect(body.data.drivebase_type).toBe('Swerve');
      expect(body.data.additional_notes).toBe('Offline note');
    });
  });

  describe('/datascout', () => {
    it('blocks anonymous and unapproved/banned access to data events (AUTHZ-03 / CRITICAL-03)', async () => {
      actor = null;
      for (const query of [
        '?all_teams=1&event_key=2026cc',
        '?list_teams=1&event_key=2026cc',
        '?team_key=frc5940&event_key=2026cc'
      ]) {
        const res = await datascoutRoute.GET({ url: new URL(`https://test/datascout${query}`), request: makeReq() });
        expect(res.status).toBe(401);
      }

      actor = { id: 'u2' };
      profileRow = { id: 'u2', role: 'member', general_role: 'none', permissions: [], banned: false };
      expect(
        (
          await datascoutRoute.GET({
            url: new URL('https://test/datascout?all_teams=1&event_key=2026cc'),
            request: makeReq()
          })
        ).status
      ).toBe(403);
    });

    it('blocks VISION_RELEASE gate bypass in POST record-event and protects vision rows in update/DELETE (AUTHZ-08)', async () => {
      // Spoofing role: 'vision' or event_type: 'hub_fuel_override' is rejected with 403
      const spoofRole = await datascoutRoute.POST({
        request: makeReq({
          action: 'record-event',
          match_key: '2026cc_qm1',
          team_key: 'frc5940',
          event_type: 'climb_pos',
          event_value: 'L3',
          role: 'vision'
        })
      });
      expect(spoofRole.status).toBe(403);

      const spoofFuel = await datascoutRoute.POST({
        request: makeReq({
          action: 'record-event',
          match_key: '2026cc_qm1',
          team_key: 'frc5940',
          event_type: 'hub_fuel_override',
          event_value: '999'
        })
      });
      expect(spoofFuel.status).toBe(403);

      // Regular scout cannot modify or delete a vision release row even if created_by matches
      const editVision = await datascoutRoute.POST({
        request: makeReq({
          action: 'update-event-timestamp',
          id: 'evt-vision',
          created_at: '2026-10-16T10:05:00.000Z'
        })
      });
      expect(editVision.status).toBe(403);

      const deleteVision = await datascoutRoute.DELETE({
        request: makeReq({ id: 'evt-vision' })
      });
      expect(deleteVision.status).toBe(403);

      // User with VISION_RELEASE can delete vision release row
      profileRow = { ...profileRow, permissions: ['CAN_SEE_ROUTES', 'VISION_RELEASE'] };
      const allowedDelete = await datascoutRoute.DELETE({
        request: makeReq({ id: 'evt-vision' })
      });
      expect(allowedDelete.status).toBe(200);
    });

    it('validates event_key, escapes match_key prefix, and bounds all_teams queries (ABUSE-05 / INJ-02)', async () => {
      const wildcardRes = await datascoutRoute.GET({
        url: new URL('https://test/datascout?all_teams=1&event_key=%25'),
        request: makeReq()
      });
      expect(wildcardRes.status).toBe(400);

      const allTeamsRes = await datascoutRoute.GET({
        url: new URL('https://test/datascout?all_teams=1&event_key=2026cc'),
        request: makeReq()
      });
      expect(allTeamsRes.status).toBe(200);
      expect(recordedFilters).toContainEqual({
        table: 'scout_data_events',
        type: 'ilike',
        field: 'match_key',
        pattern: '2026cc\\_%'
      });
      expect(recordedRanges[0]).toEqual({ table: 'scout_data_events', from: 0, to: 999 });
    });
  });
});

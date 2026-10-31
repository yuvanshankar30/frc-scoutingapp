import { json } from '@sveltejs/kit';
import { assignmentContext, listEligibleScouts } from '$lib/server/scouting/assignmentAccess.js';
import { notifyScoutAssignment, notifyScoutUnassignment } from '$lib/server/integrations/slack_notifications.js';
import { assignmentCompletionEvidence } from '$lib/scouting/scoutAssignmentCompletion.js';
import { assignmentKind } from '$lib/scouting/myAssignments.js';

const SCOUTING_TYPES = new Set(['data', 'note', 'quick']);
// Enabled by direct instruction ahead of Chezy Champs - publishing real
// scouting assignments should now DM each assigned scout.
const SCOUT_ASSIGNMENT_SLACK_DMS_ENABLED = true;

// reportKinds: user id -> 'data' | 'performance' | 'robot' (fetchReportKinds),
// so the DM names the report the scout actually files.
async function notifyPublishedScoutAssignment(assignment, reportKinds = {}) {
  if (!SCOUT_ASSIGNMENT_SLACK_DMS_ENABLED) return { ok: false, reason: 'disabled' };
  return notifyScoutAssignment({ ...assignment, reportKind: reportKinds[assignment.userId] ?? null });
}

// Report kinds for the users about to be notified; only match scouting
// ('data') has kinds, and a failed lookup just means the message says "data".
async function reportKindsFor(db, scoutingType, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (scoutingType !== 'data' || !ids.length) return {};
  return fetchReportKinds(db, ids).catch(() => ({}));
}

function canEditForType(access, scoutingType) {
  if (scoutingType === 'note') return access.canEditNote;
  if (scoutingType === 'quick') return access.canEditQuick;
  return access.canEditData;
}

function canAssignForType(access, scoutingType) {
  if (scoutingType === 'note') return access.canAssignNote;
  if (scoutingType === 'quick') return access.canAssignQuick;
  return access.canAssignData;
}

// user id -> 'data' | 'performance' | 'robot', from each person's roster keys. Keys already in hand
// (the signed-in scout's own) skip the query.
async function fetchReportKinds(db, userIds, knownKeys = {}) {
  const kinds = {};
  const missing = [];
  for (const id of userIds) {
    if (knownKeys[id]) kinds[id] = assignmentKind(knownKeys[id]);
    else missing.push(id);
  }
  if (!missing.length) return kinds;
  const { data, error } = await db
    .from('roster_entries')
    .select('user_id, key:key_id(key_name)')
    .in('user_id', missing);
  if (error) return kinds;
  const keysByUser = {};
  for (const row of data || []) {
    if (!row?.user_id) continue;
    (keysByUser[row.user_id] ||= []).push(String(row?.key?.key_name || ''));
  }
  for (const id of missing) kinds[id] = assignmentKind(keysByUser[id]);
  return kinds;
}

/*
  Scouting assignments API
  GET /api/scout-assignments?scouting_type=data|note|quick
  GET /api/scout-assignments?scouting_type=..&user_id=..&mine=1
  GET /api/scout-assignments?scouting_type=..&capabilities=1
  GET /api/scout-assignments?scouting_type=..&eligible=1

  POST actions:
    assign-single: { scouting_type, match_key, team_key, user_id }
    assign-robot:  { scouting_type, team_key, user_id }
    bulk-assign:   { scouting_type, items:[{match_key, team_key, user_id}...] }
    unassign:      { scouting_type, match_key, team_key } - removes the row
                   entirely (not a null assigned_user) and, if it had an
                   assignee, sends them a Slack DM saying so, unconditionally
                   (not gated by SCOUT_ASSIGNMENT_SLACK_DMS_ENABLED - that
                   flag is specifically about the paused assignment-DM
                   rollout, and does not cover this newer, separately
                   requested notification).
    complete:      { scouting_type, match_key, team_key }
*/

export async function GET({ url, request }) {
  try {
    const scouting_type = String(url.searchParams.get('scouting_type') || '').toLowerCase();
    if (!SCOUTING_TYPES.has(scouting_type)) {
      return json({ error: 'scouting_type required (data|note|quick)' }, { status: 400 });
    }

    const { db, actorId, access } = await assignmentContext(request);
    if (!actorId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (url.searchParams.get('capabilities')) {
      return json({
        success: true,
        data: {
          can_view: true,
          can_edit: canEditForType(access, scouting_type),
          can_be_assigned: canAssignForType(access, scouting_type),
          roster_keys: access.rosterKeys
        }
      });
    }

    if (url.searchParams.get('eligible')) {
      if (!canEditForType(access, scouting_type)) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }
      const users = await listEligibleScouts(db, { withReportKind: true });
      return json({ success: true, data: users });
    }

    const mine = !!url.searchParams.get('mine');
    const reqUserId = url.searchParams.get('user_id') || null;
    const base = db
      .from('scout_match_assignments')
      .select('id, scouting_type, match_key, team_key, assigned_user, completed_at')
      .eq('scouting_type', scouting_type);

    if (mine) {
      if (!reqUserId) return json({ error: 'user_id required' }, { status: 400 });
      if (reqUserId !== actorId) return json({ error: 'Forbidden' }, { status: 403 });
      base
        .eq('assigned_user', reqUserId)
        .order('completed_at', { ascending: true })
        .order('match_key', { ascending: true });
    } else {
      base.order('match_key', { ascending: true }).limit(5000);
    }

    const { data, error } = await base;
    if (error) return json({ error: error.message }, { status: 500 });

    let assignmentRows = data || [];
    // The trigger is the durable source of truth. This read-time reconciliation
    // is defense in depth for historical/manual keys and deployment skew.
    if (mine && scouting_type === 'data' && assignmentRows.some((row) => !row.completed_at)) {
      const eventKeys = [
        ...new Set(assignmentRows.map((row) => String(row.match_key || '').split('_')[0]).filter(Boolean))
      ];
      let reportQuery = db
        .from('match_scout_entries')
        .select('event_key, match_key, team_key, created_at, updated_at')
        .eq('created_by', actorId);
      if (eventKeys.length) reportQuery = reportQuery.in('event_key', eventKeys);
      const { data: reports, error: reportsError } = await reportQuery;
      if (!reportsError) assignmentRows = assignmentCompletionEvidence(assignmentRows, reports || []);
    }

    const ids = Array.from(new Set(assignmentRows.map((r) => r.assigned_user).filter(Boolean)));
    const nameMap = {};
    const kindMap = await fetchReportKinds(db, ids, mine ? { [actorId]: access.rosterKeys } : {});

    if (ids.length > 0) {
      const { data: users, error: uErr } = await db.from('user_profiles').select('id, full_name, email').in('id', ids);

      if (!uErr) {
        for (const u of users || []) {
          nameMap[u.id] = u.full_name || u.email || null;
        }
      }
    }

    const rows = assignmentRows.map((r) => ({
      id: r.id,
      scouting_type: r.scouting_type,
      match_key: r.match_key,
      team_key: r.team_key,
      assigned_user: r.assigned_user,
      completed_at: r.completed_at,
      user_name: r.assigned_user ? (nameMap[r.assigned_user] ?? null) : null,
      report_kind: r.assigned_user ? (kindMap[r.assigned_user] ?? 'data') : 'data'
    }));

    return json({ success: true, data: rows });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const action = body?.action;
    const scouting_type = String(body?.scouting_type || '').toLowerCase();
    if (!SCOUTING_TYPES.has(scouting_type)) {
      return json({ error: 'scouting_type required (data|note|quick)' }, { status: 400 });
    }

    const { db, actorId, access } = await assignmentContext(request);
    if (!actorId) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (action !== 'complete' && !canEditForType(access, scouting_type)) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    if (action === 'assign-single') {
      const { match_key, team_key, user_id } = body;
      if (!match_key || !team_key || !user_id) {
        return json({ error: 'match_key, team_key, user_id required' }, { status: 400 });
      }

      const { data: existing } = await db
        .from('scout_match_assignments')
        .select('id, assigned_user')
        .eq('scouting_type', scouting_type)
        .eq('match_key', match_key)
        .eq('team_key', team_key)
        .eq('assigned_user', user_id)
        .maybeSingle();

      const { data: upserted, error } = await db
        .from('scout_match_assignments')
        .upsert(
          { scouting_type, match_key, team_key, assigned_user: user_id },
          { onConflict: 'scouting_type,match_key,team_key,assigned_user' }
        )
        .select('id, assigned_user')
        .single();

      if (error) return json({ error: error.message }, { status: 500 });

      if (upserted?.assigned_user && upserted.assigned_user !== existing?.assigned_user) {
        await notifyPublishedScoutAssignment(
          {
            assignmentId: upserted.id,
            userId: upserted.assigned_user,
            matchKey: match_key,
            teamKey: team_key,
            scoutingType: scouting_type
          },
          await reportKindsFor(db, scouting_type, [upserted.assigned_user])
        );
      }
      return json({ success: true });
    }

    if (action === 'assign-robot') {
      const { team_key, user_id } = body;
      if (!team_key || !user_id) return json({ error: 'team_key, user_id required' }, { status: 400 });

      const { data: existingRows, error: existingError } = await db
        .from('scout_match_assignments')
        .select('id, match_key, team_key, assigned_user')
        .eq('scouting_type', scouting_type)
        .eq('team_key', team_key);

      if (existingError) return json({ error: existingError.message }, { status: 500 });

      const prevMap = new Map(
        (existingRows || []).map((row) => [`${row.match_key}:${row.team_key}:${row.assigned_user}`, row])
      );

      const assignments = [...new Set((existingRows || []).map((row) => row.match_key))].map((match_key) => ({
        scouting_type,
        match_key,
        team_key,
        assigned_user: user_id
      }));
      if (assignments.length === 0) return json({ success: true });

      const { data: upsertedRows, error } = await db
        .from('scout_match_assignments')
        .upsert(assignments, { onConflict: 'scouting_type,match_key,team_key,assigned_user' })
        .select('id, match_key, team_key, assigned_user');

      if (error) return json({ error: error.message }, { status: 500 });

      const robotKinds = await reportKindsFor(db, scouting_type, [user_id]);
      for (const upserted of upsertedRows || []) {
        const prev = prevMap.get(`${upserted.match_key}:${upserted.team_key}:${upserted.assigned_user}`)?.assigned_user;
        if (upserted.assigned_user && upserted.assigned_user !== prev) {
          await notifyPublishedScoutAssignment(
            {
              assignmentId: upserted.id,
              userId: upserted.assigned_user,
              matchKey: upserted.match_key,
              teamKey: upserted.team_key,
              scoutingType: scouting_type
            },
            robotKinds
          );
        }
      }
      return json({ success: true });
    }

    if (action === 'bulk-assign') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return json({ error: 'items required' }, { status: 400 });

      const rows = items.map((i) => ({
        scouting_type,
        match_key: i.match_key,
        team_key: i.team_key,
        assigned_user: i.user_id
      }));

      const matchKeys = [...new Set(items.map((i) => i.match_key))];
      const teamKeys = [...new Set(items.map((i) => i.team_key))];

      let prevMap = new Map();
      if (matchKeys.length && teamKeys.length) {
        const { data: existingRows } = await db
          .from('scout_match_assignments')
          .select('id, match_key, team_key, assigned_user')
          .eq('scouting_type', scouting_type)
          .in('match_key', matchKeys)
          .in('team_key', teamKeys);

        prevMap = new Map(
          (existingRows || []).map((row) => [`${row.match_key}:${row.team_key}:${row.assigned_user}`, row])
        );
      }

      const { data: updatedRows, error } = await db
        .from('scout_match_assignments')
        .upsert(rows, { onConflict: 'scouting_type,match_key,team_key,assigned_user' })
        .select('id, match_key, team_key, assigned_user');

      if (error) return json({ error: error.message }, { status: 500 });

      const bulkKinds = await reportKindsFor(
        db,
        scouting_type,
        (updatedRows || []).map((row) => row.assigned_user)
      );
      for (const row of updatedRows || []) {
        const prev = prevMap.get(`${row.match_key}:${row.team_key}:${row.assigned_user}`)?.assigned_user;
        if (row.assigned_user && row.assigned_user !== prev) {
          await notifyPublishedScoutAssignment(
            {
              assignmentId: row.id,
              userId: row.assigned_user,
              matchKey: row.match_key,
              teamKey: row.team_key,
              scoutingType: scouting_type
            },
            bulkKinds
          );
        }
      }
      return json({ success: true });
    }

    if (action === 'unassign') {
      const { match_key, team_key } = body;
      if (!match_key || !team_key) {
        return json({ error: 'match_key, team_key required' }, { status: 400 });
      }

      const { data: existing, error: existingError } = await db
        .from('scout_match_assignments')
        .select('id, assigned_user')
        .eq('scouting_type', scouting_type)
        .eq('match_key', match_key)
        .eq('team_key', team_key)
        .maybeSingle();
      if (existingError) return json({ error: existingError.message }, { status: 500 });
      if (!existing) return json({ success: true }); // already unassigned - nothing to do

      const { error } = await db
        .from('scout_match_assignments')
        .delete()
        .eq('scouting_type', scouting_type)
        .eq('match_key', match_key)
        .eq('team_key', team_key);
      if (error) return json({ error: error.message }, { status: 500 });

      if (existing.assigned_user) {
        await notifyScoutUnassignment({
          userId: existing.assigned_user,
          matchKey: match_key,
          teamKey: team_key,
          scoutingType: scouting_type,
          reportKind: (await reportKindsFor(db, scouting_type, [existing.assigned_user]))[existing.assigned_user],
          kind: 'match'
        });
      }
      return json({ success: true });
    }

    if (action === 'complete') {
      const { match_key, team_key } = body;
      if (!match_key || !team_key) return json({ error: 'match_key and team_key required' }, { status: 400 });

      const { data: row, error: rErr } = await db
        .from('scout_match_assignments')
        .select('assigned_user')
        .eq('scouting_type', scouting_type)
        .eq('match_key', match_key)
        .eq('team_key', team_key)
        .single();

      if (rErr) return json({ error: rErr.message }, { status: 500 });
      if (row.assigned_user !== actorId) return json({ error: 'Not owner' }, { status: 403 });

      const { error } = await db
        .from('scout_match_assignments')
        .update({ completed_at: new Date().toISOString() })
        .eq('scouting_type', scouting_type)
        .eq('match_key', match_key)
        .eq('team_key', team_key);

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

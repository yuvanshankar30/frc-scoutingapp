import { json } from '@sveltejs/kit';
import { buildExportTable, exportTableToCsv, exportTableToXlsx } from '$lib/server/scouting/readableExport.js';
import { pitScoutStatus } from '$lib/scouting/pitForm.js';
import { canManageScoutingAdmin, clientFromRequest, fetchActorProfile } from '$lib/server/scouting/scoutingAccess.js';
import { COMPETITION_ROLES, COMPETITION_ROLE_GROUPS, orderCompetitionRoles } from '$lib/scouting/competitionRoles.js';
import { escapeMatchKeyPrefix } from '$lib/scouting/eventCode.js';
import { getSupabase } from '$lib/server/serviceClient.js';
import { selectPitScoutEntries } from '$lib/server/scouting/pitScoutingSchema.js';
import { listMatchKeyReview } from '$lib/server/scouting/matchKeyReview.js';
import { scoutDisplayName } from '$lib/server/scouting/scoutIdentity.js';
import {
  fetchEventExportRecords,
  fetchEventMatches,
  fetchEventTeams,
  fetchUpcomingEvents,
  getScoutingSettings
} from '$lib/server/scouting/admin/eventData.js';
import {
  computeMissedMatchList,
  computeTypeMetrics,
  isMatchKeyForEvent,
  matchNumberForKey,
  teamKeySort
} from '$lib/server/scouting/admin/coverage.js';
import { computeQuickScoutModel, computeSmartScoutAdjustment } from '$lib/server/scouting/admin/scoutModels.js';
import {
  ensureCompetitionRoleKeys,
  fetchCompetitionRolesByUser,
  fetchCompetitionTeams
} from '$lib/server/scouting/admin/competitionRoles.js';
import { ADMIN_ACTIONS, competitionTeams as competitionTeamList } from '$lib/server/scouting/admin/actions.js';

async function actorWithRosterKeys(authSupa, db) {
  const { actorId, profile, rosterKeys } = await fetchActorProfile(authSupa, { rosterDb: db });
  return { actorId, profile: profile ? { ...profile, roster_keys: rosterKeys } : null, actorRosterKeys: rosterKeys };
}

export async function GET({ request, url }) {
  try {
    const authSupa = clientFromRequest(request);
    const db = getSupabase();
    const { actorId, profile, actorRosterKeys } = await actorWithRosterKeys(authSupa, db);

    if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!canManageScoutingAdmin(profile, actorRosterKeys)) return json({ error: 'Forbidden' }, { status: 403 });
    const settings = await getScoutingSettings(db);
    const eventKey = settings.event_key;
    const smartFuelEnabled = settings.smart_fuel_algorithm_enabled;

    if (url?.searchParams.get('resource') === 'match-key-review') {
      const { data, error } = await listMatchKeyReview(db);
      if (error) return json({ error }, { status: 500 });
      return json({ success: true, data }, { headers: { 'cache-control': 'no-store' } });
    }

    // Every kind of scouting record for the event in one readable table (readableExport.js); a date narrows it to
    // that day.
    // export-match-scouting-csv is the old name, kept so a page still open on the old layout keeps working.
    const resource = url?.searchParams.get('resource');
    if (resource === 'export-event-csv' || resource === 'export-match-scouting-csv') {
      const exportEventKey = String(url.searchParams.get('event_key') || eventKey || '').trim();
      if (!exportEventKey) return json({ error: 'Set or select a scouting event before exporting.' }, { status: 400 });
      const dateStr = String(url.searchParams.get('date') || '').trim();
      if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr))
        return json({ error: 'Dates look like 2026-09-19.' }, { status: 400 });
      // format=xlsx (the default from the page): colored Excel workbook; format=csv: the same table as plain CSV.
      const asCsv = url.searchParams.get('format') === 'csv';
      const table = buildExportTable(await fetchEventExportRecords(db, exportEventKey, dateStr || null));
      const safeEventKey = exportEventKey.replace(/[^a-z0-9_-]/gi, '_');
      const fileName = `scouting-${safeEventKey}${dateStr ? `-${dateStr}` : ''}.${asCsv ? 'csv' : 'xlsx'}`;
      return new Response(asCsv ? exportTableToCsv(table) : exportTableToXlsx(table, { eventKey: exportEventKey }), {
        headers: {
          'content-type': asCsv
            ? 'text/csv; charset=utf-8'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${fileName}"`,
          'cache-control': 'no-store'
        }
      });
    }

    const [
      upcomingRes,
      matchesRes,
      eventTeamsRes,
      usersRes,
      assignmentsRes,
      pitRes,
      matchReportsRes,
      competitionRoleKeys
    ] = await Promise.all([
      fetchUpcomingEvents(),
      fetchEventMatches(eventKey),
      fetchEventTeams(eventKey),
      db
        .from('user_profiles')
        .select('id, full_name, email, role, team_role, frc_team, banned, permissions, created_at')
        .order('full_name', { ascending: true }),
      db
        .from('scout_match_assignments')
        .select('scouting_type, match_key, team_key, assigned_user, completed_at')
        .in('scouting_type', ['data', 'note', 'quick']),
      eventKey
        ? selectPitScoutEntries(db, (query) => query.eq('event_key', eventKey))
        : Promise.resolve({ data: [], error: null, schema: null, warning: null }),
      eventKey
        ? db.from('match_scout_entries').select('*').eq('event_key', eventKey).order('updated_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      ensureCompetitionRoleKeys(db)
    ]);
    const competitionTeams = await fetchCompetitionTeams(db);

    if (usersRes.error) return json({ error: usersRes.error.message }, { status: 500 });
    if (assignmentsRes.error) return json({ error: assignmentsRes.error.message }, { status: 500 });
    if (pitRes.error) return json({ error: pitRes.error.message }, { status: 500 });
    if (matchReportsRes.error) return json({ error: matchReportsRes.error.message }, { status: 500 });

    const competitionRoleKeyIds = COMPETITION_ROLES.map((name) => competitionRoleKeys.get(name)?.id || null).filter(
      Boolean
    );
    const competitionRolesByUser = await fetchCompetitionRolesByUser(db, competitionRoleKeyIds);

    const matches = [...(matchesRes.matches || [])];
    const warning = [matchesRes.warning, upcomingRes.warning, pitRes.warning].filter(Boolean).join(' ') || null;
    const matchKeys = matches.map((m) => m.key).filter(Boolean);
    const slotTeamsByMatch = new Map();
    const teamSet = new Set();

    // Seed from the event's registered team list so pit metrics are correct
    // even before any matches are posted to TBA.
    for (const teamKey of eventTeamsRes.teamKeys || []) teamSet.add(teamKey);

    // Manually-added teams (prescouting) - lets admins seed teams before an
    // event even has a roster on TBA.
    for (const teamKey of settings.manual_teams || []) teamSet.add(teamKey);

    // Fallback: include any teams that already have pit scout entries so progress shows
    // even if TBA calls fail or the event team list is empty.
    const pitRowsForTeamSeed = pitRes.data || [];
    for (const row of pitRowsForTeamSeed) {
      if (row?.team_key) teamSet.add(row.team_key);
    }
    for (const row of matchReportsRes.data || []) {
      if (row?.team_key) teamSet.add(row.team_key);
    }

    for (const match of matches) {
      const teams = [...(match?.alliances?.blue?.team_keys || []), ...(match?.alliances?.red?.team_keys || [])];
      slotTeamsByMatch.set(match.key, teams);
      for (const teamKey of teams) teamSet.add(teamKey);
    }

    const matchPrefix = eventKey ? escapeMatchKeyPrefix(eventKey) || `${eventKey}_%` : null;
    const dataEventsRes = matchPrefix
      ? await db
          .from('scout_data_events')
          .select('match_key, team_key, created_by, event_type, event_value, created_at')
          .ilike('match_key', matchPrefix)
      : matchKeys.length
        ? await db
            .from('scout_data_events')
            .select('match_key, team_key, created_by, event_type, event_value, created_at')
            .in('match_key', matchKeys)
        : { data: [], error: null };

    if (dataEventsRes.error) return json({ error: dataEventsRes.error.message }, { status: 500 });

    const noteEventsRes = matchPrefix
      ? await db.from('scout_notes').select('match_key, team_key, created_by').ilike('match_key', matchPrefix)
      : matchKeys.length
        ? await db.from('scout_notes').select('match_key, team_key, created_by').in('match_key', matchKeys)
        : { data: [], error: null };

    if (noteEventsRes.error) return json({ error: noteEventsRes.error.message }, { status: 500 });

    // scout_data_events is shared by every scouting mode with no mode
    // column - split it here by the quick_ event_type prefix so a match
    // scouted only via Quick Scout doesn't silently count as "Data Scouted"
    // too (computeTypeMetrics has no event_type filtering of its own).
    const allDataEventRows = dataEventsRes.data || [];
    const dataEvidenceRows = allDataEventRows.filter((r) => !String(r?.event_type || '').startsWith('quick_'));
    const quickEvidenceRows = allDataEventRows.filter((r) => String(r?.event_type || '').startsWith('quick_'));
    const noteEvidenceRows = noteEventsRes.data || [];

    const assignments = (assignmentsRes.data || []).filter((row) => isMatchKeyForEvent(row?.match_key, eventKey));

    const localSlotsByMatch = new Map();
    const addLocalSlot = (matchKey, teamKey) => {
      if (!isMatchKeyForEvent(matchKey, eventKey)) return;
      if (!teamKey) return;
      if (slotTeamsByMatch.has(matchKey)) return;
      if (!localSlotsByMatch.has(matchKey)) localSlotsByMatch.set(matchKey, new Set());
      localSlotsByMatch.get(matchKey).add(teamKey);
    };

    for (const row of assignments) addLocalSlot(row?.match_key, row?.team_key);
    for (const row of dataEvidenceRows) addLocalSlot(row?.match_key, row?.team_key);
    for (const row of noteEvidenceRows) addLocalSlot(row?.match_key, row?.team_key);
    for (const row of quickEvidenceRows) addLocalSlot(row?.match_key, row?.team_key);
    for (const row of matchReportsRes.data || []) addLocalSlot(row?.match_key, row?.team_key);

    for (const [localMatchKey, teamKeys] of localSlotsByMatch.entries()) {
      const teams = [...teamKeys];
      slotTeamsByMatch.set(localMatchKey, teams);
      matches.push({
        key: localMatchKey,
        match_number: matchNumberForKey(localMatchKey),
        alliances: { blue: { team_keys: [] }, red: { team_keys: [] } }
      });
      for (const teamKey of teams) teamSet.add(teamKey);
    }

    matches.sort((a, b) => {
      const aNum = matchNumberForKey(a?.key);
      const bNum = matchNumberForKey(b?.key);
      if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
      if (aNum !== null && bNum === null) return -1;
      if (aNum === null && bNum !== null) return 1;
      return String(a?.key || '').localeCompare(String(b?.key || ''));
    });

    const users = (usersRes.data || [])
      .filter((u) => !u?.banned)
      .map((u) => ({
        id: u.id,
        full_name: u.full_name || null,
        email: u.email || null,
        role: u.role || 'member',
        approved: u.role === 'admin' || (Array.isArray(u.permissions) && u.permissions.includes('CAN_SEE_ROUTES')),
        created_at: u.created_at || null,
        frc_team: competitionTeams.get(u.id) || u.frc_team || null,
        profile_frc_team: u.frc_team || null,
        competition_roles: orderCompetitionRoles([...(competitionRolesByUser.get(u.id) || [])])
      }));

    const userNameMap = new Map(users.map((u) => [u.id, u.full_name || u.email || u.id]));
    const profilesById = new Map(users.map((u) => [u.id, u]));
    const matchReports = (matchReportsRes.data || []).map((report) => ({
      ...report,
      scout_name: scoutDisplayName(report, profilesById)
    }));
    const matchReportMatches = new Set(matchReports.map((report) => report.match_key).filter(Boolean));
    const matchReportTeams = new Set(matchReports.map((report) => report.team_key).filter(Boolean));

    const dataMetrics = computeTypeMetrics({
      type: 'data',
      assignments,
      matches,
      slotTeamsByMatch,
      evidenceRows: dataEvidenceRows,
      userNameMap
    });

    const noteMetrics = computeTypeMetrics({
      type: 'note',
      assignments,
      matches,
      slotTeamsByMatch,
      evidenceRows: noteEvidenceRows,
      userNameMap
    });

    const quickMetrics = computeTypeMetrics({
      type: 'quick',
      assignments,
      matches,
      slotTeamsByMatch,
      evidenceRows: quickEvidenceRows,
      userNameMap
    });

    const pitRows = pitRes.data || [];
    const pitStatusByTeam = new Map(
      pitRows.filter((row) => row?.team_key).map((row) => [row.team_key, pitScoutStatus(row)])
    );

    const totalTeams = teamSet.size;
    const pitStatusCounts = { pending: 0, needs_photo: 0, completed: 0 };
    for (const teamKey of teamSet) {
      const status = pitStatusByTeam.get(teamKey) || 'pending';
      pitStatusCounts[status] = (pitStatusCounts[status] || 0) + 1;
    }
    const pitScoutedTeams = pitStatusCounts.completed;

    const totalMatches = matches.length;
    const missedMatches = computeMissedMatchList(
      dataMetrics.missed_assignments,
      noteMetrics.missed_assignments,
      quickMetrics.missed_assignments
    );

    const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
    const smartFuelModel = computeSmartScoutAdjustment({
      matches,
      dataEvents: dataEvidenceRows,
      userNameMap,
      enabled: smartFuelEnabled
    });
    const quickScoutModel = computeQuickScoutModel({
      matches,
      quickEvents: quickEvidenceRows
    });

    return json({
      success: true,
      data: {
        event_key: eventKey || null,
        smart_fuel_algorithm_enabled: smartFuelEnabled,
        google_sheet_id: settings.google_sheet_id,
        google_sheet_last_synced_at: settings.google_sheet_last_synced_at,
        google_sheet_last_sync_error: settings.google_sheet_last_sync_error,
        manual_teams: [...(settings.manual_teams || [])].sort(teamKeySort),
        upcoming_events: upcomingRes.events || [],
        warning,
        competition_role_groups: COMPETITION_ROLE_GROUPS,
        competition_teams: await competitionTeamList(),
        users,
        metrics: {
          pit: {
            scouted_teams: pitScoutedTeams,
            pending_teams: pitStatusCounts.pending,
            needs_photo_teams: pitStatusCounts.needs_photo,
            completed_teams: pitStatusCounts.completed,
            total_teams: totalTeams,
            percent: pct(pitScoutedTeams, totalTeams)
          },
          data: {
            assigned_matches: dataMetrics.assigned_matches,
            scouted_matches: dataMetrics.scouted_matches,
            total_matches: totalMatches,
            assigned_percent: dataMetrics.assigned_match_percent,
            scouted_percent: dataMetrics.scouted_match_percent,
            missed_shifts: dataMetrics.missed_shifts,
            missed_shift_percent: dataMetrics.missed_shift_percent
          },
          note: {
            assigned_matches: noteMetrics.assigned_matches,
            scouted_matches: noteMetrics.scouted_matches,
            total_matches: totalMatches,
            assigned_percent: noteMetrics.assigned_match_percent,
            scouted_percent: noteMetrics.scouted_match_percent,
            missed_shifts: noteMetrics.missed_shifts,
            missed_shift_percent: noteMetrics.missed_shift_percent
          },
          quick: {
            assigned_matches: quickMetrics.assigned_matches,
            scouted_matches: quickMetrics.scouted_matches,
            total_matches: totalMatches,
            assigned_percent: quickMetrics.assigned_match_percent,
            scouted_percent: quickMetrics.scouted_match_percent,
            missed_shifts: quickMetrics.missed_shifts,
            missed_shift_percent: quickMetrics.missed_shift_percent
          },
          match: {
            reports: matchReports.length,
            matches: matchReportMatches.size,
            teams: matchReportTeams.size
          },
          overall: {
            assigned_percent: pct(
              dataMetrics.assigned_matches + noteMetrics.assigned_matches,
              Math.max(1, totalMatches * 2)
            ),
            scouted_percent: pct(
              dataMetrics.scouted_matches + noteMetrics.scouted_matches,
              Math.max(1, totalMatches * 2)
            ),
            missed_shift_percent: pct(
              dataMetrics.missed_shifts + noteMetrics.missed_shifts,
              Math.max(1, dataMetrics.assigned_slots + noteMetrics.assigned_slots)
            )
          }
        },
        missed_matches: missedMatches,
        match_reports: matchReports,
        smart_fuel_model: smartFuelModel,
        quick_scout_model: quickScoutModel
      }
    });
  } catch (e) {
    return json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const action = String(body?.action || '');

    const authSupa = clientFromRequest(request);
    const db = getSupabase();
    const { actorId, profile, actorRosterKeys } = await actorWithRosterKeys(authSupa, db);
    if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!canManageScoutingAdmin(profile, actorRosterKeys)) return json({ error: 'Forbidden' }, { status: 403 });

    const handler = Object.hasOwn(ADMIN_ACTIONS, action) ? ADMIN_ACTIONS[action] : null;
    if (!handler) return json({ error: 'Invalid action' }, { status: 400 });
    return await handler({ db, body, action, actorId, profile });
  } catch (e) {
    return json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}

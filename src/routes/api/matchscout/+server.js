import { json } from '@sveltejs/kit';
import { clientFromRequest, dbClient, userFor, unwrapSingle } from '$lib/server/supabaseClients.js';
import {
  normalizeMatchScoutEntry,
  normalizePitProblemReport,
  normalizeTeamKey,
  requiresPitProblemReport,
  validatePitProblemHandoff
} from '$lib/server/scouting/matchScoutingSchema.js';
import { customAnswersFor } from '$lib/server/scouting/customAnswers.js';
import { notifyPitProblem } from '$lib/server/integrations/pit_problem_notifications.js';
import {
  combinedPitProblemFields,
  mergeScoutObservation,
  scoutObservation
} from '$lib/scouting/pitProblemObservations.js';
import { averagePowerRankings } from '$lib/scouting/powerRankingAverages.js';
import { matchKeyFor } from '$lib/matches/matchKeys.js';
import { tbaMatchLabel } from '$lib/matches/matchKeys.js';
import { canonicalMatchKey, canonicalReports } from '$lib/matches/matchKeys.js';
import { resolveScoutedBy, scoutDisplayName, scoutProfilesFor } from '$lib/server/scouting/scoutIdentity.js';
import { tbaMatchKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { canAdministerFrom, canAdministerOr, isApprovedProfile } from '$lib/server/scouting/scoutingAccess.js';
import { tbaJson } from '$lib/server/integrations/tba.js';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

// Backend for match scouting and the pit-problem handoff.
//
// Both existed only in the browser before this: the match scouting workspace
// had no server at all, and a flagged pit problem went to window.localStorage
// - which is per-device, so the pit crew it was written for could never see
// it. Everything here exists to get that data off the one phone it was
// entered on.

async function fetchProfile(db, actorId) {
  if (!actorId) return null;
  const { data } = await db
    .from('user_profiles')
    .select('id, role, permissions, general_role, team_role, banned, full_name, email')
    .eq('id', actorId)
    .maybeSingle();
  return unwrapSingle(data);
}

async function fetchRosterKeys(db, actorId) {
  const { data } = await db.from('roster_entries').select('key:key_id(key_name)').eq('user_id', actorId);
  return (data || []).map((row) => row?.key?.key_name).filter(Boolean);
}

function stripPitProblemSlackMeta(row) {
  if (!row || typeof row !== 'object') return row;
  const { slack_channel, slack_ts, slack_last_payload, ...rest } = row;
  return rest;
}

async function findSharedPitProblem(db, report) {
  const { data } = await db
    .from('pit_problem_reports')
    .select('*')
    .eq('event_key', report.event_key)
    .eq('team_key', report.team_key)
    .eq('match_key', report.match_key)
    .eq('source', 'Match scout')
    .eq('resolved', false)
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function saveSharedPitProblem(db, report, scoutName) {
  const observation = scoutObservation({
    report,
    scoutId: report.created_by,
    scoutName
  });
  const saveExisting = async (existing) => {
    const observations = mergeScoutObservation(existing.scout_observations, observation);
    const fields = combinedPitProblemFields(observations);
    return db
      .from('pit_problem_reports')
      .update({ ...fields, scout_observations: observations })
      .eq('id', existing.id)
      .select('*')
      .single();
  };

  const existing = await findSharedPitProblem(db, report);
  if (existing) return saveExisting(existing);

  const observations = [observation];
  const fields = combinedPitProblemFields(observations);
  const inserted = await db
    .from('pit_problem_reports')
    .insert({ ...report, ...fields, scout_observations: observations })
    .select('*')
    .single();
  if (inserted.error?.code !== '23505') return inserted;

  // A simultaneous second scout can race the first insert. The partial
  // unique index chooses one row; merge this observation into it once.
  const racedExisting = await findSharedPitProblem(db, report);
  return racedExisting ? saveExisting(racedExisting) : inserted;
}

export async function GET({ request, url }) {
  const client = clientFromRequest(request);
  const actor = await userFor(client);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });

  const db = dbClient(client);
  const profile = await fetchProfile(db, actor.id);
  if (!isApprovedProfile(profile)) {
    return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });
  }
  if (url.searchParams.get('resource') === 'start-photos') {
    const { data, error } = await db
      .from('scouting_settings')
      .select('start_position_photos')
      .eq('id', 1)
      .maybeSingle();
    if (error) return json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    const photos = {};
    for (const [key, path] of Object.entries(data?.start_position_photos || {})) {
      if (typeof path !== 'string' || !path.startsWith('match-starts/')) continue;
      const { data: signed } = await db.storage.from('pit-scout-photos').createSignedUrl(path, 3600);
      if (signed?.signedUrl) photos[key] = signed.signedUrl;
    }
    return json({ success: true, data: photos }, { headers: NO_STORE_HEADERS });
  }
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!eventKey) return json({ error: 'event_key is required' }, { status: 400, headers: NO_STORE_HEADERS });

  const resource = url.searchParams.get('resource') || 'entries';

  // The robots in one match, for the Performance tab's power ranking, from The Blue Alliance. An unknown match returns
  // empty alliances, and the page lets the scout type the robots in instead.
  if (resource === 'match-teams') {
    const matchKey = matchKeyFor(eventKey, url.searchParams.get('match_key'));
    if (!matchKey) return json({ error: 'match_key is required' }, { status: 400, headers: NO_STORE_HEADERS });
    const match = await tbaJson(`/match/${encodeURIComponent(await tbaMatchKeyFor(matchKey))}/simple`);
    return json(
      {
        success: true,
        data: {
          match_key: matchKey,
          red: match?.alliances?.red?.team_keys || [],
          blue: match?.alliances?.blue?.team_keys || [],
          label: match ? tbaMatchLabel(match) : null
        }
      },
      { headers: NO_STORE_HEADERS }
    );
  }

  // Every scout's Performance > Power ranking for the event, averaged per match and per robot.
  if (resource === 'power-rankings') {
    const { data, error } = await db
      .from('match_scout_entries')
      .select('id, match_key, created_by, scout_name, power_ranking, created_at, updated_at')
      .eq('event_key', eventKey);
    if (error && (error.code === '42703' || /power_ranking/.test(error.message || '')))
      return json(
        { success: true, data: { matches: [], teams: [] }, unavailable: true },
        { headers: NO_STORE_HEADERS }
      );
    if (error) return json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    // Scouts type the match as "3", "qm3" or the full key; one canonical key per match keeps their rankings together.
    return json(
      { success: true, data: averagePowerRankings(canonicalReports(data || [], eventKey)) },
      { headers: NO_STORE_HEADERS }
    );
  }

  if (resource === 'pit-problems') {
    // The pit crew's actual question is "what is still open", so unresolved
    // reports come first and newest-first within that.
    let query = db.from('pit_problem_reports').select('*').eq('event_key', eventKey);
    if (url.searchParams.get('open') === '1') query = query.eq('resolved', false);
    const teamKey = normalizeTeamKey(url.searchParams.get('team_key'));
    if (teamKey) query = query.eq('team_key', teamKey);
    const { data, error } = await query.order('resolved').order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    return json({ success: true, data: (data || []).map(stripPitProblemSlackMeta) }, { headers: NO_STORE_HEADERS });
  }

  // Coverage counts only need who was scouted in which match, not whole reports.
  const columns = url.searchParams.get('fields') === 'coverage' ? 'team_key,match_key' : '*';
  let query = db.from('match_scout_entries').select(columns).eq('event_key', eventKey);
  if (url.searchParams.get('mine') === '1') query = query.eq('created_by', actor.id);
  const teamKey = normalizeTeamKey(url.searchParams.get('team_key'));
  if (teamKey) query = query.eq('team_key', teamKey);
  const matchParam = String(url.searchParams.get('match_key') || '').trim();
  if (matchParam) query = query.eq('match_key', canonicalMatchKey(matchParam, eventKey) || matchParam);
  const { data, error } = await query.order('match_key').order('team_key');
  if (error) return json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  const entries = data || [];
  const profiles = await scoutProfilesFor(db, entries);
  return json(
    {
      success: true,
      data: entries.map((entry) => ({ ...entry, scout_name: scoutDisplayName(entry, profiles) }))
    },
    { headers: NO_STORE_HEADERS }
  );
}

export async function POST({ request }) {
  const client = clientFromRequest(request);
  const actor = await userFor(client);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = dbClient(client);
  const profile = await fetchProfile(db, actor.id);
  if (!isApprovedProfile(profile)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === 'save-entry') {
    // All live submissions follow v2. The legacy normalizer exists only for
    // historical data; omitting form_version cannot bypass required answers.
    const { value, error: invalid } = normalizeMatchScoutEntry({ ...body, form_version: 2 }, actor.id);
    if (invalid) return json({ error: invalid }, { status: 400 });
    const handoffError = validatePitProblemHandoff(body);
    if (handoffError) return json({ error: handoffError }, { status: 400 });
    const custom = await customAnswersFor(db, 'match', body);
    if (custom.error) return json({ error: custom.error }, { status: 400 });
    value.custom_answers = custom.answers;
    value.custom_form_version = custom.version;
    value.scouted_by = await resolveScoutedBy(db, {
      actorId: actor.id,
      actorName: profile?.full_name,
      scoutName: value.scout_name
    });

    // Keyed on the scout and the report kind as well as the match, so two
    // people covering the same robot both keep their observations instead of
    // overwriting each other, one scout can file a data, a performance and a
    // robot report for the same robot, and revising a report updates it in place.
    const save = (row) =>
      db
        .from('match_scout_entries')
        .upsert(row, { onConflict: 'event_key,match_key,team_key,created_by,report_kind' })
        .select('*')
        .single();
    let { data, error } = await save(value);
    // Until the robot_present migration (20261024000000) reaches a database, save without the column so no report
    // is lost, keeping a no-show readable in the notes.
    if (error && /robot_present/.test(error.message || '')) {
      const { robot_present: robotPresent, ...withoutPresent } = value;
      if (robotPresent === false)
        withoutPresent.post_notes = ['Robot did not show up.', withoutPresent.post_notes].filter(Boolean).join(' ');
      ({ data, error } = await save(withoutPresent));
    }
    // Same for the detail columns (20260104000000_match_report_detail_fields): the report saves without them rather than not at all.
    if (error && /\b(defense|bps|robot_status_shifts|foul_nature|foul_details)\b/.test(error.message || '')) {
      const { defense, bps, robot_status_shifts, foul_nature, foul_details, ...withoutNew } = value;
      ({ data, error } = await save(withoutNew));
    }
    if (error) return json({ error: error.message }, { status: 500 });

    let pitProblem = null;
    let pitNotification = null;
    if (
      body.teleop_robot_status === 'dead' ||
      body.mechanical_break === true ||
      body.report_pit_problem === true ||
      requiresPitProblemReport(body.robot_disabled)
    ) {
      const { value: report, error: reportInvalid } = normalizePitProblemReport(
        {
          event_key: body.event_key,
          team_key: body.team_key,
          match_key: body.match_key,
          summary: body.pit_problem_summary,
          detail: body.pit_problem_detail,
          robot_disabled: value.robot_disabled
        },
        actor.id
      );
      if (reportInvalid) return json({ error: reportInvalid }, { status: 400 });

      const { data: savedProblem, error: reportError } = await saveSharedPitProblem(
        db,
        report,
        data.scout_name || actor.email
      );
      if (reportError) return json({ error: reportError.message }, { status: 500 });
      pitProblem = savedProblem;

      pitNotification = await notifyPitProblem(savedProblem, data.scout_name || actor.email);
      if (pitNotification.ok) {
        const slackDelivery = {
          slack_channel: pitNotification.channel,
          slack_ts: pitNotification.ts,
          slack_last_payload: pitNotification.payload,
          slack_notified_at: new Date().toISOString()
        };
        const { error: slackTrackingError } = await db
          .from('pit_problem_reports')
          .update(slackDelivery)
          .eq('id', savedProblem.id);
        if (slackTrackingError)
          console.error('Failed to save the pit problem Slack delivery details', slackTrackingError.message);
        pitProblem = { ...savedProblem, ...slackDelivery };
      }
    }

    return json({ success: true, data, pit_problem: pitProblem, pit_notification: pitNotification });
  }

  if (action === 'report-pit-problem') {
    const { value, error: invalid } = normalizePitProblemReport(body, actor.id);
    if (invalid) return json({ error: invalid }, { status: 400 });
    const { data, error } = await saveSharedPitProblem(db, value, body.scout_name || actor.email);
    if (error) return json({ error: error.message }, { status: 500 });
    const pitNotification = await notifyPitProblem(data, body.scout_name || actor.email);
    if (pitNotification.ok) {
      const slackDelivery = {
        slack_channel: pitNotification.channel,
        slack_ts: pitNotification.ts,
        slack_last_payload: pitNotification.payload,
        slack_notified_at: new Date().toISOString()
      };
      const { error: slackTrackingError } = await db
        .from('pit_problem_reports')
        .update(slackDelivery)
        .eq('id', data.id);
      if (slackTrackingError)
        console.error('Failed to save the pit problem Slack delivery details', slackTrackingError.message);
      return json({ success: true, data: { ...data, ...slackDelivery }, pit_notification: pitNotification });
    }
    return json({ success: true, data, pit_notification: pitNotification });
  }

  if (action === 'delete-entry') {
    if (!body?.id) return json({ error: 'id is required' }, { status: 400 });

    // Removing someone's submitted report is meaningfully more sensitive
    // than submitting your own, so this checks scouting-admin-equivalent
    // access rather than just "logged in" - same bar as publishing scout
    // assignments (see computeScoutingAccess in api/scout-assignments).
    const rosterKeys = await fetchRosterKeys(db, actor.id);
    if (!canAdministerOr(profile, rosterKeys, 'REMOVE_REPORTS')) return json({ error: 'Forbidden' }, { status: 403 });

    const { error } = await db.from('match_scout_entries').delete().eq('id', body.id);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  }

  if (action === 'resolve-pit-problem') {
    if (!body?.id) return json({ error: 'id is required' }, { status: 400 });
    const { data: existingRow, error: lookupError } = await db
      .from('pit_problem_reports')
      .select('*')
      .eq('id', body.id)
      .maybeSingle();
    if (lookupError) return json({ error: lookupError.message }, { status: 500 });
    const existing = unwrapSingle(existingRow);
    if (!existing) return json({ error: 'Pit problem report not found' }, { status: 404 });

    const isOwner =
      existing.created_by === actor.id ||
      (Array.isArray(existing.scout_observations) &&
        existing.scout_observations.some((obs) => obs?.scout_id === actor.id));
    if (!isOwner) {
      const rosterKeys = await fetchRosterKeys(db, actor.id);
      const generalRole = String(profile?.general_role || '')
        .trim()
        .toLowerCase();
      const canResolve =
        canAdministerFrom(profile, rosterKeys) || generalRole === 'lead' || generalRole === 'subsystem_lead';
      if (!canResolve) return json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolved = body.resolved !== false;
    const { data, error } = await db
      .from('pit_problem_reports')
      .update({
        resolved,
        // Reopening clears the resolution rather than leaving a stale one, so
        // "who closed this" always refers to the closure that is in force.
        resolved_by: resolved ? actor.id : null,
        resolved_at: resolved ? new Date().toISOString() : null
      })
      .eq('id', body.id)
      .select('*')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    const pitNotification = await notifyPitProblem(data, actor.email);
    if (pitNotification.ok) {
      const slackDelivery = {
        slack_channel: pitNotification.channel,
        slack_ts: pitNotification.ts,
        slack_last_payload: pitNotification.payload,
        slack_notified_at: new Date().toISOString()
      };
      const { error: slackTrackingError } = await db
        .from('pit_problem_reports')
        .update(slackDelivery)
        .eq('id', data.id);
      if (slackTrackingError)
        console.error('Failed to save the pit problem Slack delivery details', slackTrackingError.message);
      return json({ success: true, data: { ...data, ...slackDelivery }, pit_notification: pitNotification });
    }
    return json({ success: true, data, pit_notification: pitNotification });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
}

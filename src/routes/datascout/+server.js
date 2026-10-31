import { json } from '@sveltejs/kit';
import { querySingle } from '$lib/server/supabaseClients.js';
import { requireScoutingActor, resolveEventKey } from '$lib/server/scouting/scoutingAccess.js';
import { hasPermission } from '$lib/app/permissions.js';
import { escapeMatchKeyPrefix, normalizeEventCode } from '$lib/scouting/eventCode.js';
import { normalizeTeamKey } from '$lib/server/scouting/matchScoutingSchema.js';
import notescoutConfig from '$lib/scouting/notescout.json';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_MATCH_EVENTS = 500;
const MAX_TEAM_EVENTS = 1000;
const MAX_RECENT_EVENTS = 1000;
const MAX_LIST_TEAMS_ROWS = 2000;
const MAX_ALL_TEAMS_ROWS = 10000;
const ALL_TEAMS_PAGE_SIZE = 1000;
const MATCH_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,79}$/i;
const EVENT_TYPE_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

function isVisionReleaseEvent({ event_type, role } = {}) {
  const normRole = String(role ?? '')
    .trim()
    .toLowerCase();
  const normType = String(event_type ?? '')
    .trim()
    .toLowerCase();
  return normRole === 'vision' || normType === 'hub_fuel_override';
}

function canAdminDataScout(profile, rosterKeys = []) {
  if (!profile || profile.banned === true) return false;
  if (profile.role === 'admin') return true;
  return hasPermission({ ...profile, roster_keys: rosterKeys }, 'DATA_SCOUT_ADMIN');
}

function canModifyVisionReleaseRow(profile, rosterKeys = []) {
  if (!profile || profile.banned === true) return false;
  if (profile.role === 'admin') return true;
  const userWithRoster = { ...profile, roster_keys: rosterKeys };
  return hasPermission(userWithRoster, 'VISION_RELEASE') || hasPermission(userWithRoster, 'DATA_SCOUT_ADMIN');
}

/*
  Data Scout API
  POST actions:
    - record-event: { action, match_key, match_number, team_key, phase, event_type, event_value, role, on_shift }
    - update-event-timestamp: { action, id, created_at } => used by Quick Scout's editable
      timeline to correct a mistimed toggle tap; same ownership rule as DELETE below.
  DELETE actions:
    - { id } => deletes specific event
  GET query params:
    - ?team_key=... => all events for team (scoped to event)
    - ?team_key=...&match_key=... => events for that match/team
    - ?list_teams=1 => list of distinct team keys (scoped to event)
    - ?all_teams=1&event_key=... => narrow event-wide rows (capped at 10,000)
*/

export async function POST({ request }) {
  try {
    const body = await request.json();

    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }
    const { db, actor, profile, rosterKeys } = auth;

    if (body?.action === 'update-event-timestamp') {
      const { id, created_at } = body;
      if (!id || !created_at) {
        return json({ error: 'Missing required fields' }, { status: 400, headers: PRIVATE_HEADERS });
      }

      const { data: row, error: rowErr } = await querySingle(
        db.from('scout_data_events').select('created_by, role, event_type').eq('id', id)
      );

      if (rowErr) return json({ error: rowErr.message }, { status: 500, headers: PRIVATE_HEADERS });
      if (!row) return json({ error: 'Event not found' }, { status: 404, headers: PRIVATE_HEADERS });

      const canEdit = isVisionReleaseEvent(row)
        ? canModifyVisionReleaseRow(profile, rosterKeys)
        : canAdminDataScout(profile, rosterKeys) || row?.created_by === actor.id;
      if (!canEdit) return json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE_HEADERS });

      const { data, error } = await db
        .from('scout_data_events')
        .update({ created_at })
        .eq('id', id)
        .select('*')
        .single();

      if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      return json({ success: true, data }, { headers: PRIVATE_HEADERS });
    }

    if (body?.action !== 'record-event') {
      return json({ error: 'Invalid action' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const { match_number, phase, event_value, role, on_shift } = body;
    const rawMatchKey = String(body?.match_key || '').trim();
    const rawTeamKey = String(body?.team_key || '').trim();
    const rawEventType = String(body?.event_type || '').trim();
    if (!rawMatchKey || !rawTeamKey || !rawEventType) {
      return json({ error: 'Missing required fields' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    if (isVisionReleaseEvent({ event_type: rawEventType, role })) {
      return json(
        { error: 'Forbidden: vision release events cannot be recorded via /datascout' },
        { status: 403, headers: PRIVATE_HEADERS }
      );
    }

    if (!MATCH_KEY_RE.test(rawMatchKey) || !normalizeEventCode(rawMatchKey.split('_')[0])) {
      return json({ error: 'Invalid match_key' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const team_key = normalizeTeamKey(rawTeamKey);
    if (!team_key || !/^frc\d{1,5}$/.test(team_key)) {
      return json({ error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    if (!EVENT_TYPE_RE.test(rawEventType)) {
      return json({ error: 'Invalid event_type' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const cleanRole = role !== undefined && role !== null ? String(role).trim().slice(0, 60) || null : null;
    const cleanValue = event_value !== undefined && event_value !== null ? String(event_value).slice(0, 500) : null;
    const cleanPhase = phase ? String(phase).trim().slice(0, 40) : null;

    const payload = {
      match_key: rawMatchKey,
      match_number: Number(match_number) || null,
      team_key,
      phase: cleanPhase,
      event_type: rawEventType,
      event_value: cleanValue,
      role: cleanRole,
      on_shift: typeof on_shift === 'boolean' ? on_shift : null,
      // Authenticated identity is authoritative; never accept attribution
      // supplied by a caller in the JSON body.
      created_by: actor.id,
      created_at: new Date().toISOString()
    };

    const { data, error } = await db.from('scout_data_events').insert([payload]).select('*').single();
    if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
    return json({ success: true, data }, { headers: PRIVATE_HEADERS });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function DELETE({ request }) {
  try {
    const { id } = await request.json();
    if (!id) return json({ error: 'Missing ID' }, { status: 400, headers: PRIVATE_HEADERS });

    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }
    const { db, actor, profile, rosterKeys } = auth;

    const { data: row, error: rowErr } = await querySingle(
      db.from('scout_data_events').select('created_by, role, event_type').eq('id', id)
    );

    if (rowErr) return json({ error: rowErr.message }, { status: 500, headers: PRIVATE_HEADERS });
    if (!row) return json({ error: 'Event not found' }, { status: 404, headers: PRIVATE_HEADERS });

    const canDelete = isVisionReleaseEvent(row)
      ? canModifyVisionReleaseRow(profile, rosterKeys)
      : canAdminDataScout(profile, rosterKeys) || row?.created_by === actor.id;
    if (!canDelete) return json({ error: 'Forbidden' }, { status: 403, headers: PRIVATE_HEADERS });

    const { error } = await db.from('scout_data_events').delete().eq('id', id);
    if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });

    return json({ success: true }, { headers: PRIVATE_HEADERS });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function GET({ url, request }) {
  try {
    const auth = await requireScoutingActor(request);
    if (!auth.ok) {
      return json({ error: auth.error }, { status: auth.status, headers: PRIVATE_HEADERS });
    }
    const { db } = auth;

    const rawTeamKey = String(url.searchParams.get('team_key') || '').trim();
    const rawMatchKey = String(url.searchParams.get('match_key') || '').trim();
    const rawEventKey = String(url.searchParams.get('event_key') || '').trim();

    if (rawMatchKey && (!MATCH_KEY_RE.test(rawMatchKey) || !normalizeEventCode(rawMatchKey.split('_')[0]))) {
      return json({ error: 'Invalid match_key' }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const resolved = await resolveEventKey(db, rawEventKey, {
      matchKey: rawMatchKey,
      fallbackEventKey: notescoutConfig?.event_key
    });
    if (resolved.error) {
      return json({ error: resolved.error }, { status: 400, headers: PRIVATE_HEADERS });
    }

    const escapedPrefix = escapeMatchKeyPrefix(resolved.eventKey);
    const applyEventFilter = (query) => (escapedPrefix ? query.ilike('match_key', escapedPrefix) : query);

    if (rawTeamKey && rawMatchKey) {
      const team_key = normalizeTeamKey(rawTeamKey);
      if (!team_key || !/^frc\d{1,5}$/.test(team_key)) {
        return json({ error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
      }
      let query = db.from('scout_data_events').select('*').eq('team_key', team_key).eq('match_key', rawMatchKey);
      query = applyEventFilter(query).order('created_at', { ascending: true });
      if (typeof query?.limit === 'function') {
        query = query.limit(MAX_MATCH_EVENTS);
      }
      const { data, error } = await query;

      if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      return json({ success: true, data: data || [] }, { headers: PRIVATE_HEADERS });
    }

    if (rawTeamKey) {
      const team_key = normalizeTeamKey(rawTeamKey);
      if (!team_key || !/^frc\d{1,5}$/.test(team_key)) {
        return json({ error: 'Invalid team_key' }, { status: 400, headers: PRIVATE_HEADERS });
      }
      let query = db.from('scout_data_events').select('*').eq('team_key', team_key);
      query = applyEventFilter(query).order('created_at', { ascending: true });
      if (typeof query?.limit === 'function') {
        query = query.limit(MAX_TEAM_EVENTS);
      }
      const { data, error } = await query;

      if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
      return json({ success: true, data: data || [] }, { headers: PRIVATE_HEADERS });
    }

    if (url.searchParams.get('list_teams')) {
      let query = db.from('scout_data_events').select('team_key');
      query = applyEventFilter(query);
      const { data, error } = await query.order('team_key', { ascending: true }).limit(MAX_LIST_TEAMS_ROWS);

      if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });

      const seen = new Set();
      const teams = [];
      for (const row of data || []) {
        const t = row?.team_key;
        if (t && !seen.has(t)) {
          seen.add(t);
          teams.push(t);
        }
      }
      return json({ success: true, data: teams }, { headers: PRIVATE_HEADERS });
    }

    if (url.searchParams.get('all_teams')) {
      const pageSize = ALL_TEAMS_PAGE_SIZE;
      const maxRows = MAX_ALL_TEAMS_ROWS;
      const rows = [];
      for (let from = 0; from < maxRows; from += pageSize) {
        let query = db.from('scout_data_events').select('id,match_key,team_key,event_type,event_value,created_at');
        query = applyEventFilter(query);
        const { data, error } = await query
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
        rows.push(...(data || []));
        if ((data || []).length < pageSize) break;
      }
      return json({ success: true, data: rows, truncated: rows.length >= maxRows }, { headers: PRIVATE_HEADERS });
    }

    const requestedRecent = Number(url.searchParams.get('recent') || '100');
    const recent = Number.isFinite(requestedRecent)
      ? Math.min(Math.max(Math.trunc(requestedRecent), 1), MAX_RECENT_EVENTS)
      : 100;
    let query = db.from('scout_data_events').select('*');
    query = applyEventFilter(query);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(recent);

    if (error) return json({ error: error.message }, { status: 500, headers: PRIVATE_HEADERS });
    return json({ success: true, data: data || [] }, { headers: PRIVATE_HEADERS });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

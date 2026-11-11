import { json } from '@sveltejs/kit';
import notescoutConfig from '$lib/scouting/notescout.json';
import { tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { requireApprovedUser } from '$lib/server/scouting/scoutingAccess.js';
import { normalizeEventCode } from '$lib/scouting/eventCode.js';
import { tbaEventName } from '$lib/server/integrations/tba.js';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function fallbackEventKey() {
  return String(notescoutConfig?.event_key || '').trim() || null;
}

async function getActiveEventSettings(db) {
  const primary = await db.from('scouting_settings').select('event_key, manual_teams').eq('id', 1).maybeSingle();

  if (!primary.error) {
    return {
      event_key: String(primary.data?.event_key || '').trim() || fallbackEventKey(),
      manual_teams: Array.isArray(primary.data?.manual_teams) ? primary.data.manual_teams : []
    };
  }

  // Backward compatibility before the manual_teams migration has been applied.
  const fallback = await db.from('scouting_settings').select('event_key').eq('id', 1).maybeSingle();

  return {
    event_key: fallback.error
      ? fallbackEventKey()
      : String(fallback.data?.event_key || '').trim() || fallbackEventKey(),
    manual_teams: []
  };
}

// TBA event keys never contain underscores, so the text before the first
// underscore in a match_key (format `{event_key}_{comp_level}{match_number}`,
// e.g. "2026arc_qm1") is always the exact event_key.
function eventKeyFromMatchKey(matchKey) {
  const raw = String(matchKey || '').trim();
  if (!raw) return '';
  return raw.split('_')[0] || '';
}

// Old events' scouting rows aren't deleted when a new active event is set -
// they're just hidden by the current event-key-only query scoping. This
// finds every distinct event_key with real historical data across the
// scouting tables, plus the active event even before data arrives, so the UI
// can offer every useful event with its TBA name.
async function fetchDistinctEventKeys(db, activeEventKey = '') {
  const [pitRes, dataRes, noteRes, matchRes, problemRes, createdRes] = await Promise.all([
    db.from('pit_scout_entries').select('event_key'),
    db.from('scout_data_events').select('match_key'),
    db.from('scout_notes').select('match_key'),
    db.from('match_scout_entries').select('event_key'),
    db.from('pit_problem_reports').select('event_key'),
    // Codes an admin created, even before any scouting data exists for them.
    db.from('scouting_events').select('event_key')
  ]);

  const keys = new Set();
  if (activeEventKey) keys.add(activeEventKey);
  for (const row of pitRes.data || []) {
    const key = String(row?.event_key || '').trim();
    if (key) keys.add(key);
  }
  for (const row of dataRes.data || []) {
    const key = eventKeyFromMatchKey(row?.match_key);
    if (key) keys.add(key);
  }
  for (const row of noteRes.data || []) {
    const key = eventKeyFromMatchKey(row?.match_key);
    if (key) keys.add(key);
  }
  for (const result of [matchRes, problemRes, createdRes]) {
    for (const row of result.data || []) {
      const key = String(row?.event_key || '').trim();
      if (key) keys.add(key);
    }
  }

  return [...keys];
}

async function fetchEventLabel(eventKey) {
  return (await tbaEventName(await tbaEventKeyFor(eventKey))) || eventKey;
}

async function fetchAvailableEvents(db, activeEventKey = '') {
  const eventKeys = await fetchDistinctEventKeys(db, activeEventKey);
  if (!eventKeys.length) return [];

  // Promise.allSettled so one failed TBA lookup can't break the whole list -
  // any event whose fetch fails or resolves without a usable name/year just
  // falls back to displaying its raw event_key string.
  const labelResults = await Promise.allSettled(eventKeys.map((key) => fetchEventLabel(key)));
  const options = eventKeys.map((key, idx) => {
    const result = labelResults[idx];
    const label = result.status === 'fulfilled' && result.value ? result.value : key;
    return { value: key, label };
  });

  options.sort((a, b) => b.value.localeCompare(a.value));
  return options;
}

// Listing every past event scans five tables and asks TBA for each event's
// name, so it is opt-in (?events=1) and remembered briefly. Almost every caller
// only needs the active event key.
const EVENTS_TTL_MS = 60 * 1000;
let eventsCache = { key: '', at: 0, value: [] };

async function cachedAvailableEvents(db, activeEventKey) {
  if (eventsCache.key === activeEventKey && Date.now() - eventsCache.at < EVENTS_TTL_MS) return eventsCache.value;
  try {
    const value = await fetchAvailableEvents(db, activeEventKey);
    eventsCache = { key: activeEventKey, at: Date.now(), value };
    return value;
  } catch {
    return [];
  }
}

export async function GET({ url, request, setHeaders }) {
  setHeaders?.({ 'cache-control': 'private, no-store' });
  const access = await requireApprovedUser(request);
  if (!access.ok) {
    return json({ error: access.error }, { status: access.status, headers: NO_STORE_HEADERS });
  }
  try {
    const db = access.db;
    const { event_key: eventKey, manual_teams: manualTeams } = await getActiveEventSettings(db);
    const wantsEvents = url.searchParams.get('events') === '1';
    const availableEvents = wantsEvents ? await cachedAvailableEvents(db, eventKey) : [];
    return json(
      { success: true, data: { event_key: eventKey, manual_teams: manualTeams, available_events: availableEvents } },
      { headers: NO_STORE_HEADERS }
    );
  } catch {
    return json(
      { success: true, data: { event_key: fallbackEventKey(), manual_teams: [], available_events: [] } },
      { headers: NO_STORE_HEADERS }
    );
  }
}

export async function POST({ request }) {
  try {
    const access = await requireApprovedUser(request);
    if (!access.ok) return json({ error: access.error }, { status: access.status, headers: NO_STORE_HEADERS });
    if (!access.can('MANAGE_EVENT')) return json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE_HEADERS });

    const body = await request.json();
    const rawEventKey = String(body?.event_key || '').trim();
    if (!rawEventKey) return json({ error: 'event_key is required' }, { status: 400, headers: NO_STORE_HEADERS });
    const nextEventKey = normalizeEventCode(rawEventKey);
    if (!nextEventKey) return json({ error: 'Invalid event_key' }, { status: 400, headers: NO_STORE_HEADERS });

    const db = access.db;
    const { data, error } = await db
      .from('scouting_settings')
      .upsert(
        { id: 1, event_key: nextEventKey, updated_by: access.actorId, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select('event_key')
      .single();

    if (error) return json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
    eventsCache = { key: '', at: 0, value: [] };
    return json({ success: true, data: { event_key: data?.event_key || nextEventKey } }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    return json({ error: e?.message || 'Internal error' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

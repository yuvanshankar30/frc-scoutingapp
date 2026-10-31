// Event data for Scouting Admin: settings, the event's matches and teams from The Blue Alliance, upcoming
// events, and the daily match scouting CSV export.
import notescoutConfig from '$lib/scouting/notescout.json';
import { localDayRangeUtc } from '$lib/server/scouting/scoutingCsvExport.js';
import { selectPitScoutEntries } from '$lib/server/scouting/pitScoutingSchema.js';
import { escapeMatchKeyPrefix } from '$lib/scouting/eventCode.js';
import { relabelTbaPayload, tbaEventKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { MISSING_TBA_KEY, tbaAuthKey, tbaFetch, tbaJson } from '$lib/server/integrations/tba.js';
import { loadTeamSettings } from '$lib/server/teamSettings.js';

export const CSV_PAGE_SIZE = 1000;

export function fallbackEventKey() {
  return String(notescoutConfig?.event_key || '').trim() || null;
}

export async function getScoutingSettings(db) {
  const emptySettings = {
    event_key: fallbackEventKey(),
    smart_fuel_algorithm_enabled: false,
    google_sheet_id: null,
    google_sheet_last_synced_at: null,
    google_sheet_last_sync_error: null,
    manual_teams: []
  };

  const primary = await db
    .from('scouting_settings')
    .select(
      'event_key, smart_fuel_algorithm_enabled, google_sheet_id, google_sheet_last_synced_at, google_sheet_last_sync_error, manual_teams'
    )
    .eq('id', 1)
    .maybeSingle();

  if (!primary.error) {
    return {
      event_key: String(primary.data?.event_key || '').trim() || fallbackEventKey(),
      smart_fuel_algorithm_enabled: !!primary.data?.smart_fuel_algorithm_enabled,
      google_sheet_id: primary.data?.google_sheet_id || null,
      google_sheet_last_synced_at: primary.data?.google_sheet_last_synced_at || null,
      google_sheet_last_sync_error: primary.data?.google_sheet_last_sync_error || null,
      manual_teams: Array.isArray(primary.data?.manual_teams) ? primary.data.manual_teams : []
    };
  }

  // Backward compatibility before the migration has been applied.
  const fallback = await db.from('scouting_settings').select('event_key').eq('id', 1).maybeSingle();

  if (fallback.error) return emptySettings;
  return {
    event_key: String(fallback.data?.event_key || '').trim() || fallbackEventKey(),
    smart_fuel_algorithm_enabled: false,
    google_sheet_id: null,
    manual_teams: [],
    google_sheet_last_synced_at: null,
    google_sheet_last_sync_error: null
  };
}

export async function fetchEventMatches(eventKey) {
  if (!eventKey) return { matches: [], warning: 'No event configured.' };
  if (!tbaAuthKey()) return { matches: [], warning: `${MISSING_TBA_KEY}.` };

  try {
    const tbaKey = await tbaEventKeyFor(eventKey);
    const response = await tbaFetch(`/event/${encodeURIComponent(tbaKey)}/matches`);
    if (!response.ok) return { matches: [], warning: `TBA request failed (${response.status}).` };

    // Match keys come back under the competition code, so they line up with scouting reports.
    const raw = relabelTbaPayload(await response.json(), tbaKey, eventKey);
    const matches = (raw || [])
      .filter((m) => m?.comp_level === 'qm')
      .sort((a, b) => (a?.match_number || 0) - (b?.match_number || 0));
    return { matches, warning: null };
  } catch (e) {
    return { matches: [], warning: e?.message || 'Failed to fetch TBA matches.' };
  }
}

export async function fetchEventTeams(eventKey) {
  if (!eventKey) return { teamKeys: [] };
  const raw = await tbaJson(`/event/${encodeURIComponent(await tbaEventKeyFor(eventKey))}/teams/simple`);
  return { teamKeys: (raw || []).map((t) => t?.key).filter(Boolean) };
}

export async function fetchUpcomingEvents() {
  if (!tbaAuthKey()) return { events: [], warning: null };

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Events your teams (Team settings) are registered for.
  const { settings } = await loadTeamSettings();
  const teams = settings ? [settings.teamNumber, ...settings.otherTeamNumbers].map((number) => `frc${number}`) : [];
  if (!teams.length) return { events: [], warning: null };
  const paths = [
    ...teams.map((team) => `/team/${team}/events/upcoming/simple`),
    ...teams.map((team) => `/team/${team}/events/${currentYear}/simple`),
    ...teams.map((team) => `/team/${team}/events/${currentYear + 1}/simple`)
  ];

  try {
    const responses = await Promise.all(paths.map((path) => tbaFetch(path)));
    const okResponses = responses.filter((r) => r.ok);
    if (!okResponses.length) {
      const statuses = responses.map((r) => r?.status).filter(Boolean);
      // "No upcoming events" comes back as 404s: an empty state, not an operator-facing error.
      if (statuses.length > 0 && statuses.every((s) => s === 404)) return { events: [], warning: null };
      return { events: [], warning: `TBA events request failed (${responses[0]?.status || 'unknown'}).` };
    }

    const byKey = new Map();
    for (const list of await Promise.all(okResponses.map((r) => r.json()))) {
      for (const ev of list || []) {
        if (!ev?.key) continue;
        byKey.set(ev.key, {
          key: ev.key,
          name: ev.name || ev.key,
          year: ev.year || null,
          start_date: ev.start_date || null,
          end_date: ev.end_date || null
        });
      }
    }

    const events = [...byKey.values()]
      .filter((ev) => !ev?.end_date || String(ev.end_date) >= yesterdayIso)
      .sort(
        (a, b) =>
          String(a.start_date || '9999-12-31').localeCompare(String(b.start_date || '9999-12-31')) ||
          String(a.key).localeCompare(String(b.key))
      );
    return { events, warning: null };
  } catch (e) {
    return { events: [], warning: e?.message || 'Failed to fetch upcoming events.' };
  }
}

// Every row of one table for the event, a page at a time; `scope` narrows the query (event column, day range).
async function allRows(db, table, scope) {
  const rows = [];
  for (let offset = 0; ; offset += CSV_PAGE_SIZE) {
    const { data, error } = await scope(db.from(table).select('*'))
      .order('created_at', { ascending: true })
      .range(offset, offset + CSV_PAGE_SIZE - 1);
    if (error) {
      // A table a database has not got yet (local dev) leaves that record type out instead of failing the export.
      if (/does not exist|schema cache/i.test(error.message || '')) return rows;
      throw new Error(`Could not export ${table}: ${error.message}`);
    }
    rows.push(...(data || []));
    if ((data || []).length < CSV_PAGE_SIZE) return rows;
  }
}

/**
 * The whole event's scouting, ready to export (readableExport.js): match scouting (Data, Performance and Robot
 * reports), pit scouting, the scouts' match rankings, scout notes and pit problems. With a date (YYYY-MM-DD, Pacific)
 * only records created that day; without one, everything.
 */
export async function fetchEventExportRecords(db, eventKey, dateStr = null) {
  const range = dateStr ? localDayRangeUtc(dateStr) : null;
  const byDay = (query) => (range ? query.gte('created_at', range.start).lt('created_at', range.end) : query);
  const byEvent = (query) => byDay(query.eq('event_key', eventKey));
  // Notes have no event column; their match keys start with the event key.
  const byMatchPrefix = (query) => byDay(query.ilike('match_key', escapeMatchKeyPrefix(eventKey)));
  const [matchEntries, notes, problems, rankings, pit] = await Promise.all([
    allRows(db, 'match_scout_entries', byEvent),
    allRows(db, 'scout_notes', byMatchPrefix),
    allRows(db, 'pit_problem_reports', byEvent),
    allRows(db, 'scouting_match_rankings', byEvent),
    selectPitScoutEntries(db, (query) => byEvent(query).order('team_key', { ascending: true }))
  ]);
  if (pit.error) throw new Error(`Could not export pit scouting: ${pit.error.message}`);
  return { matchEntries, pitEntries: Array.isArray(pit.data) ? pit.data : [], rankings, notes, problems };
}

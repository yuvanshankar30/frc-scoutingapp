// Shared state for the Data Viewer pages. The layout (src/routes/dataviewer/+layout.svelte) creates it once and loads
// the event's scouting there, so moving between the overview, a field's page and a scout entry never loads it again.
// Pages read it with useDataViewer().
import { getContext, setContext } from 'svelte';
import { derived, get, writable } from 'svelte/store';
import { getAuthHeader } from '$lib/app/supabase.js';
import { fetchWithCache } from '$lib/app/offlineCache.js';
import { fetchActiveScoutingEventKey, fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
import { fieldsFor, formSections } from '$lib/scouting/dataViewerFields.js';
import { emptyFilters } from '$lib/scouting/dataViewer.js';

const KEY = Symbol('data-viewer');

/** The form versions reports were answered against, newest first, plus the live one; a failed load is left out. */
async function loadSchemas(entries, headers) {
  const versionsFor = (rows) => [
    ...new Set(rows.map((row) => Number(row.custom_form_version)).filter((v) => Number.isInteger(v) && v > 0))
  ];
  const fetchForm = async (formType, version) => {
    const suffix = version ? `&version=${version}` : '';
    const response = await fetch(`/api/scouting-forms?form=${formType}${suffix}`, { headers }).catch(() => null);
    const payload = await response?.json().catch(() => null);
    return payload?.success ? payload.data : null;
  };
  const schemas = {};
  for (const formType of ['match', 'pit']) {
    const loaded = await Promise.all([
      fetchForm(formType, null),
      ...versionsFor(entries[formType]).map((version) => fetchForm(formType, version))
    ]);
    schemas[formType] = loaded
      .filter((entry) => entry?.schema)
      .sort((a, b) => (b.version || 0) - (a.version || 0))
      .map((entry) => entry.schema);
  }
  return schemas;
}

export function createDataViewer() {
  const activeEventKey = writable('');
  const selectedEventKey = writable(null);
  const availableEvents = writable([]);
  const report = writable(null);
  const schemas = writable({ match: [], pit: [] });
  const teamNames = writable(new Map());
  // The TBA roster, for teams nobody has scouted yet (Rankings lists them).
  const eventTeams = writable([]);
  const loading = writable(true);
  const error = writable('');
  const loadedEventKey = writable('');

  // What the reader picked. Kept here so it survives opening a field or an entry and coming back.
  const form = writable('match');
  const sections = writable({ match: formSections('match')[0].id, pit: formSections('pit')[0].id });
  const filters = writable(emptyFilters());
  const search = writable('');
  const hideEmpty = writable(false);

  const eventKey = derived([selectedEventKey, activeEventKey], ([selected, active]) => selected || active);
  const records = derived(report, ($report) => ({
    match: $report?.match_entries || [],
    pit: $report?.pit_entries || []
  }));
  const fields = derived(schemas, ($schemas) => ({
    match: fieldsFor('match', $schemas.match),
    pit: fieldsFor('pit', $schemas.pit)
  }));

  function applyTeams(payload) {
    if (!payload?.success) return;
    eventTeams.set(payload.data || []);
    teamNames.set(
      new Map(
        (payload.data || [])
          .map((row) => [String(row.key || '').toLowerCase(), String(row.nickname || row.name || '').trim()])
          .filter(([key, name]) => key && name)
      )
    );
  }

  async function load() {
    const forEvent = get(eventKey);
    if (!forEvent) {
      report.set(null);
      loading.set(false);
      return;
    }
    loading.set(true);
    error.set('');
    try {
      const headers = await getAuthHeader();
      // A cached roster refills these at once; another event's teams must not linger.
      if (forEvent !== get(loadedEventKey)) {
        eventTeams.set([]);
        teamNames.set(new Map());
      }
      fetchWithCache(`/api/tba/event-teams?event_key=${encodeURIComponent(forEvent)}`, {
        cacheKey: `event-teams:${forEvent}`,
        onUpdate: (payload) => forEvent === get(eventKey) && applyTeams(payload)
      }).catch(() => {});
      const response = await fetch(`/api/scouting-report?event_key=${encodeURIComponent(forEvent)}`, { headers });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Could not load scouting data.');
      const data = payload.data || {};
      const nextSchemas = await loadSchemas({ match: data.match_entries || [], pit: data.pit_entries || [] }, headers);
      if (forEvent !== get(eventKey)) return;
      report.set(data);
      schemas.set(nextSchemas);
      // Teams picked at another event aren't at this one.
      const here = new Set([...(data.match_entries || []), ...(data.pit_entries || [])].map((row) => row.team_key));
      filters.update((value) => ({ ...value, teams: value.teams.filter((key) => here.has(key)) }));
    } catch (cause) {
      report.set(null);
      error.set(cause?.message || 'Could not load scouting data.');
    } finally {
      loadedEventKey.set(forEvent);
      if (forEvent === get(eventKey)) loading.set(false);
    }
  }

  async function start() {
    const [active, events] = await Promise.all([fetchActiveScoutingEventKey(), fetchAvailableScoutingEvents()]);
    activeEventKey.set(active);
    availableEvents.set(events);
    await load();
  }

  return {
    activeEventKey,
    selectedEventKey,
    availableEvents,
    eventKey,
    report,
    schemas,
    teamNames,
    eventTeams,
    loading,
    error,
    loadedEventKey,
    form,
    sections,
    filters,
    search,
    hideEmpty,
    records,
    fields,
    load,
    start
  };
}

export const provideDataViewer = (state) => setContext(KEY, state);
export const useDataViewer = () => getContext(KEY);

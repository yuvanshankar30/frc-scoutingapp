import { getAuthHeader } from '$lib/app/supabase.js';

// One /api/scouting-config request serves every caller on the page: the layout,
// the page itself and any helper below ask for the same small answer, so they
// share an in-flight request and a short-lived result instead of each paying a
// round trip.
const CONFIG_TTL_MS = 15 * 1000;
let sharedConfig = { promise: null, at: 0 };

async function readConfig(fetchImpl, query = '') {
  const shareable = fetchImpl === fetch && !query;
  if (shareable && sharedConfig.promise && Date.now() - sharedConfig.at < CONFIG_TTL_MS) return sharedConfig.promise;
  const request = (async () => {
    const authHeaders = await getAuthHeader().catch(() => ({}));
    const res = Object.keys(authHeaders).length
      ? await fetchImpl(`/api/scouting-config${query}`, { headers: authHeaders })
      : await fetchImpl(`/api/scouting-config${query}`);
    const data = await res.json().catch(() => null);
    return res.ok && data?.success ? data.data : null;
  })();
  if (shareable) {
    sharedConfig = { promise: request, at: Date.now() };
    request.then(
      (value) => {
        if (!value) sharedConfig = { promise: null, at: 0 };
      },
      () => {
        sharedConfig = { promise: null, at: 0 };
      }
    );
  }
  return request;
}

// Called after an admin changes the active event, so the next read asks the server again
// instead of returning the 15-second-old answer for the previous event.
export function forgetSharedConfig() {
  sharedConfig = { promise: null, at: 0 };
}

const LAST_EVENT_STORAGE_KEY = 'scouting_last_event_key';

export function clearStoredEventKey(storage = globalThis.localStorage) {
  forgetSharedConfig();
  try {
    storage?.removeItem?.(LAST_EVENT_STORAGE_KEY);
  } catch {
    /* storage can be unavailable */
  }
}

// The event this browser last saw as active. Pages use it to start loading event
// data right away while the config request confirms it, instead of showing
// nothing until that first round trip returns.
export function lastKnownEventKey() {
  try {
    return localStorage.getItem(LAST_EVENT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function rememberEventKey(key) {
  try {
    localStorage.setItem(LAST_EVENT_STORAGE_KEY, key);
  } catch {
    /* storage can be unavailable */
  }
}

export async function fetchActiveScoutingEventKey(fetchImpl = fetch) {
  try {
    const config = await readConfig(fetchImpl);
    const key = String(config?.event_key || '').trim() || null;
    if (key) {
      try {
        localStorage.setItem(LAST_EVENT_STORAGE_KEY, key);
      } catch {
        /* storage can be unavailable */
      }
    }
    return key;
  } catch {
    return null;
  }
}

// Teams a scouting admin typed in manually for the active event (prescouting,
// before an event has a roster on TBA) - see /scouting-admin.
export async function fetchManualScoutingTeams(fetchImpl = fetch) {
  try {
    const config = await readConfig(fetchImpl);
    return Array.isArray(config?.manual_teams) ? config.manual_teams : [];
  } catch {
    return [];
  }
}

// { value, label } options for every past event with real scouting data,
// sorted newest-first - lets scouting pages offer a "browse a past event"
// dropdown alongside the always-current active event key above.
export async function fetchAvailableScoutingEvents(fetchImpl = fetch) {
  try {
    const config = await readConfig(fetchImpl, '?events=1');
    return Array.isArray(config?.available_events) ? config.available_events : [];
  } catch {
    return [];
  }
}

import { writable } from 'svelte/store';
import {
  fetchActiveScoutingEventKey,
  forgetSharedConfig,
  lastKnownEventKey,
  rememberEventKey
} from '$lib/scouting/scoutingEvent.js';

// The competition every scouting page works from, shown in the site header. Starts from the
// last value this browser saw so the header is not empty while the first request returns.
export const activeEventKey = writable('');

export async function refreshActiveEvent() {
  const key = await fetchActiveScoutingEventKey();
  if (key) activeEventKey.set(key);
}

export function primeActiveEvent() {
  const known = lastKnownEventKey();
  if (known) activeEventKey.set(known);
}

// An admin just changed the event: show it in the header at once and make every later read ask
// the server rather than reuse the previous event from the short-lived cache.
export function setActiveEvent(key) {
  forgetSharedConfig();
  rememberEventKey(key);
  activeEventKey.set(key);
}

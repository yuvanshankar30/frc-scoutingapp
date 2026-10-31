// The team's settings in the browser: filled from the root layout's server load and refreshed after an admin
// saves Team settings. Pages read the team (number, name, colors) from here instead of hardcoding it.
import { derived, writable } from 'svelte/store';
import { setAppTimeZone } from '$lib/app/timezone.js';

export const team = writable(null);

export function setTeam(settings) {
  team.set(settings || null);
  if (settings?.timeZone) setAppTimeZone(settings.timeZone);
}

/** "frc1234" for the team this app belongs to, or '' before setup. */
export const ourTeamKey = derived(team, ($team) => $team?.teamKey || '');
/** 1234, or null before setup. */
export const ourTeamNumber = derived(team, ($team) => $team?.teamNumber || null);

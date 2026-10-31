import { loadTeamSettings } from '$lib/server/teamSettings.js';

// The team's settings (name, colors, logo, timezone) for every page, including the sign-in page. This load
// does not read the URL, so it runs once per full page load rather than on every navigation; that keeps
// moving between pages working offline. hooks.server.js sends people to /setup until setup is done.
export async function load() {
  const { settings, error } = await loadTeamSettings();
  return { team: settings, settingsError: error };
}

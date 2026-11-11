// Reads the team's settings (the app_settings row) for the server, with a short cache so every page load does
// not cost a database round trip. Writes go through saveTeamSettings so the cache and the server's timezone stay
// in step with what was saved.
import { getSupabase } from '$lib/server/serviceClient.js';
import { normalizeTeamSettings } from '$lib/app/teamSettings.js';
import { setAppTimeZone } from '$lib/app/timezone.js';
import { isCompetitionLead } from '$lib/scouting/competitionRoles.js';
import { withTimeout } from '$lib/app/withTimeout.js';

const MAX_LOGO_BYTES = 256 * 1024; // sent as base64 JSON, which must stay under the server's 512 KB body limit

const CACHE_MS = 30_000;
// A database that accepts the connection but never answers (a stopped local Supabase, a dead tunnel) would hold every
// page load forever. Give up after this long and show the "not connected" screen instead.
const READ_TIMEOUT_MS = 5000;
const TIMED_OUT = { data: null, error: { message: 'The database did not answer in time.' } };
let cached = null;
let cachedAt = 0;

export const SETTINGS_COLUMNS =
  'team_number, team_name, other_team_numbers, app_name, app_short_name, brand_color, default_theme, time_zone, logo_url, hidden_features, allow_sign_up, appearance';
const LEGACY_COLUMNS = SETTINGS_COLUMNS.replace(', appearance', '');

/**
 * { settings, error }: settings has teamNumber null until an admin sets the team. error is set when the database
 * cannot be reached or the schema has not been applied, so the layout can say what is wrong.
 */
export async function loadTeamSettings({ fresh = false, db = null } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < CACHE_MS) return cached;
  let result;
  try {
    const client = db || getSupabase();
    const read = (columns) =>
      withTimeout(client.from('app_settings').select(columns).eq('id', 1).maybeSingle(), READ_TIMEOUT_MS, TIMED_OUT);
    let { data, error } = await read(SETTINGS_COLUMNS);
    // A database without the appearance column (an older copy of the schema) still loads, with the
    // default look, instead of stopping every page.
    if (error && /appearance/.test(error.message || '')) ({ data, error } = await read(LEGACY_COLUMNS));
    if (error) result = { settings: null, error: error.message || 'Could not read app_settings' };
    else result = { settings: normalizeTeamSettings(data), error: null };
  } catch (error) {
    result = { settings: null, error: error?.message || 'Could not reach the database' };
  }
  if (result.settings) setAppTimeZone(result.settings.timeZone);
  // Only a working answer is cached, so a fixed configuration is picked up on the next request.
  if (!result.error) {
    cached = result;
    cachedAt = Date.now();
  }
  return result;
}

export function forgetTeamSettings() {
  cached = null;
  cachedAt = 0;
}

/** Writes app_settings columns (already validated) and returns the fresh settings. */
export async function saveTeamSettings(columns, { db = null } = {}) {
  const client = db || getSupabase();
  const { error } = await client
    .from('app_settings')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(error.message);
  forgetTeamSettings();
  return (await loadTeamSettings({ fresh: true, db: client })).settings;
}

/** Admins, the Competition Lead and roles carrying EDIT_TEAM_SETTINGS may change the team settings. */
export const canEditTeamSettings = (profile, rosterKeys) =>
  Boolean(
    profile &&
    !profile.banned &&
    (profile.role === 'admin' ||
      isCompetitionLead(profile, rosterKeys) ||
      (Array.isArray(profile.permissions) && profile.permissions.includes('EDIT_TEAM_SETTINGS')))
  );

/** "data:image/png;base64,..." -> { type, bytes }, or an error. */
export function decodeLogo(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return { error: 'The logo must be a PNG, JPEG or WebP image.' };
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) return { error: 'The logo file is empty.' };
  if (bytes.length > MAX_LOGO_BYTES) return { error: 'The logo must be 256 KB or smaller.' };
  return { type: match[1], bytes };
}

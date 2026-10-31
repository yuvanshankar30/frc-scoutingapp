// First-run setup: makes the first admin account and saves the team's settings, once.
//
// Who may do it: whoever knows SETUP_TOKEN, a secret set in the server's environment. Without it, the first
// stranger to open a freshly deployed site could claim it. Once setup is done this route refuses everything,
// and an admin changes the settings in Scouting Admin > Team settings instead.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSupabase } from '$lib/server/serviceClient.js';
import { forgetTeamSettings, loadTeamSettings } from '$lib/server/teamSettings.js';
import { validateTeamSettingsInput } from '$lib/app/teamSettings.js';
import { isValidTimeZone } from '$lib/app/timezone.js';
import { tokenMatches, validateAdminInput } from '$lib/server/setup.js';
import { allowRequest } from '$lib/server/assistant/rateLimit.js';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Whether setup is still open, and whether the server is ready for it. */
export async function GET() {
  const { settings, error } = await loadTeamSettings({ fresh: true });
  return json(
    {
      configured: Boolean(settings?.configured),
      tokenConfigured: Boolean(env.SETUP_TOKEN),
      databaseError: error ? 'The database is not reachable or the schema has not been applied yet.' : null
    },
    { headers: NO_STORE }
  );
}

export async function POST({ request, getClientAddress }) {
  if (!allowRequest(`setup:${safeAddress(getClientAddress)}`, { limit: 10, windowMs: 10 * 60_000 }))
    return json(
      { error: 'Too many setup attempts. Wait a few minutes and try again.' },
      { status: 429, headers: NO_STORE }
    );

  if (!env.SETUP_TOKEN)
    return json(
      { error: 'Set SETUP_TOKEN in the server environment, restart the server, then try again.' },
      { status: 503, headers: NO_STORE }
    );

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });
  if (!tokenMatches(body.setupToken, env.SETUP_TOKEN))
    return json({ error: 'That setup token is not right.' }, { status: 403, headers: NO_STORE });

  const team = validateTeamSettingsInput(body.team, { isValidTimeZone });
  if (team.error) return json({ error: team.error }, { status: 400, headers: NO_STORE });
  const admin = validateAdminInput(body.admin);
  if (admin.error) return json({ error: admin.error }, { status: 400, headers: NO_STORE });

  const db = getSupabase();

  // Claim setup: the one settings row is created here and only here, so of two people setting up at the same
  // moment exactly one gets through. It stays unfinished (no setup_completed_at) until the admin exists.
  const { data: existing, error: readError } = await db
    .from('app_settings')
    .select('id, setup_completed_at')
    .eq('id', 1)
    .maybeSingle();
  if (readError)
    return json({ error: 'The database is not ready. Apply the schema first.' }, { status: 500, headers: NO_STORE });
  if (existing?.setup_completed_at)
    return json({ error: 'This site is already set up.' }, { status: 409, headers: NO_STORE });
  if (!existing) {
    const { error: claimError } = await db.from('app_settings').insert({ id: 1, ...team.value });
    if (claimError)
      return json(
        { error: claimError.code === '23505' ? 'Setup is already in progress somewhere else.' : claimError.message },
        { status: 409, headers: NO_STORE }
      );
  }

  try {
    const created = await db.auth.admin.createUser({
      email: admin.value.email,
      password: admin.value.password,
      email_confirm: true,
      user_metadata: { name: admin.value.fullName }
    });
    if (created.error) throw new Error(created.error.message);
    const userId = created.data.user.id;

    // The new-user trigger made a pending profile; this one is the site's first admin.
    const { error: profileError } = await db.from('user_profiles').upsert(
      {
        id: userId,
        email: admin.value.email,
        full_name: admin.value.fullName,
        role: 'admin',
        general_role: 'lead',
        permissions: ['CAN_SEE_ROUTES'],
        frc_team: String(team.value.team_number),
        banned: false
      },
      { onConflict: 'id' }
    );
    if (profileError) {
      await db.auth.admin.deleteUser(userId).catch(() => {});
      throw new Error(profileError.message);
    }

    const now = new Date().toISOString();
    const { error: finishError } = await db
      .from('app_settings')
      .update({ ...team.value, setup_completed_at: now, setup_by: userId, updated_by: userId, updated_at: now })
      .eq('id', 1);
    if (finishError) throw new Error(finishError.message);
    forgetTeamSettings();
    return json({ success: true, email: admin.value.email }, { headers: NO_STORE });
  } catch (error) {
    // Give the claim back so setup can be tried again.
    await db.from('app_settings').delete().eq('id', 1).is('setup_completed_at', null);
    forgetTeamSettings();
    console.error('First-run setup failed', error?.message || error);
    return json(
      { error: `Setup did not finish: ${error?.message || 'unknown error'}` },
      { status: 500, headers: NO_STORE }
    );
  }
}

function safeAddress(getClientAddress) {
  try {
    return getClientAddress();
  } catch {
    return 'unknown';
  }
}

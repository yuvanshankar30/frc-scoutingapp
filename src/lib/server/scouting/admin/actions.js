// Scouting Admin's POST actions. Each takes { db, body, action, actorId, profile } for a caller who has
import {
  COMPETITION_ROLES,
  SCOUTING_ADMIN_ROLES,
  isCompetitionLead,
  orderCompetitionRoles
} from '$lib/scouting/competitionRoles.js';
import { MENTOR_TEAM } from '$lib/app/permissions.js';
import { competitionTeamChoices } from '$lib/app/teamSettings.js';
import { loadTeamSettings } from '$lib/server/teamSettings.js';
import { PIT_SCOUT_PHOTO_BUCKET, clearAllScoutingData } from '$lib/server/scouting/admin/dataReset.js';
import { ensureCompetitionRoleKeys } from '$lib/server/scouting/admin/competitionRoles.js';
import { fixMatchKey } from '$lib/server/scouting/matchKeyReview.js';
import { getScoutingSettings } from '$lib/server/scouting/admin/eventData.js';
import { json } from '@sveltejs/kit';
import { normalizeEventCode } from '$lib/scouting/eventCode.js';
import { normalizeTeamKey } from '$lib/server/scouting/matchScoutingSchema.js';
import { syncScoutingDataToSheet } from '$lib/server/integrations/google_sheets_sync.js';
import { tbaEventName } from '$lib/server/integrations/tba.js';
import { teamKeySort } from '$lib/server/scouting/admin/coverage.js';
import { toEmail } from '$lib/app/loginEmail.js';
// already passed the Scouting Admin check, and returns the JSON response.

/** The teams a person can compete for: the ones in Team settings, plus Mentor. */
export async function competitionTeams() {
  return competitionTeamChoices((await loadTeamSettings()).settings);
}

// Competition Lead is the top competition role, so it passes every admin-only check here.
// The profile carries the caller's roster_keys.
export function isFullAdmin(profile) {
  if (!profile || profile.banned) return false;
  return profile.role === 'admin' || profile.is_dev === true || isCompetitionLead(profile);
}

export const ADMIN_ACTIONS = {
  'fix-match-key': async ({ db, body }) => {
    const { data, error, status } = await fixMatchKey(db, { kind: body.kind, id: body.id, match: body.match });
    if (error) return json({ error }, { status });
    return json({ success: true, data });
  },
  'update-event-key': async ({ db, body, action, actorId }) => {
    const eventKey = normalizeEventCode(body?.event_key);
    if (!eventKey)
      return json(
        { error: 'Enter a competition code like 2026mttd: the year followed by the event code.' },
        { status: 400 }
      );

    // Creating a code accepts one TBA does not list yet (an off-season or practice event); it
    // only reports what TBA calls it. Existing scouting data is never touched: other events'
    // rows stay in place and simply stop matching the active event key.
    const eventName = action === 'create-event-key' ? await tbaEventName(eventKey) : null;

    const { data, error } = await db
      .from('scouting_settings')
      .upsert(
        { id: 1, event_key: eventKey, updated_by: actorId, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select('event_key')
      .single();

    if (error) return json({ error: error.message }, { status: 500 });

    // Remember a created code so it stays in the event picker after another event is made active.
    // Best effort: the picker still works from scouting data if this table is not there yet.
    if (action === 'create-event-key') {
      await db
        .from('scouting_events')
        .upsert(
          { event_key: eventKey, name: eventName, created_by: actorId },
          { onConflict: 'event_key', ignoreDuplicates: true }
        );
    }
    return json({ success: true, data: { event_key: data?.event_key || eventKey, event_name: eventName } });
  },
  'create-event-key': (ctx) => ADMIN_ACTIONS['update-event-key'](ctx),
  'update-smart-fuel-algorithm': async ({ db, body, actorId }) => {
    const enabled = !!body?.enabled;
    const update = await db
      .from('scouting_settings')
      .upsert(
        {
          id: 1,
          smart_fuel_algorithm_enabled: enabled,
          updated_by: actorId,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'id' }
      )
      .select('smart_fuel_algorithm_enabled')
      .single();

    if (update.error) {
      return json(
        {
          error:
            update.error.message || 'Failed to update smart_fuel_algorithm_enabled. Run the latest migration first.'
        },
        { status: 500 }
      );
    }

    return json({
      success: true,
      data: {
        smart_fuel_algorithm_enabled: !!update.data?.smart_fuel_algorithm_enabled
      }
    });
  },
  'update-google-sheet-id': async ({ db, body, actorId }) => {
    // Empty string is valid input here - clears the configured sheet
    // (turns the sync back off) rather than being rejected like a blank
    // event_key is above, since "no sheet configured" is this feature's
    // normal off state, not an error condition.
    const sheetId = String(body?.google_sheet_id ?? '').trim();
    const { data, error } = await db
      .from('scouting_settings')
      .upsert(
        { id: 1, google_sheet_id: sheetId || null, updated_by: actorId, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select('google_sheet_id')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: { google_sheet_id: data?.google_sheet_id || null } });
  },
  'sync-scouting-sheet': async () => {
    const result = await syncScoutingDataToSheet();
    return json({ success: result.ok, data: result });
  },
  'create-user': async ({ db, body }) => {
    // Create a login by hand (Add user tab). getSupabase() holds the service_role key, so auth.admin.createUser
    // is allowed here. The handle_new_user trigger makes a pending profile; an account an admin creates is
    // approved straight away.
    const identifier = String(body?.username || '').trim();
    const password = String(body?.password ?? '');
    const fullName = String(body?.full_name || '').trim();
    const frcTeam = String(body?.frc_team || '').trim();
    if (!identifier) return json({ error: 'A username or email is required' }, { status: 400 });
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, { status: 400 });

    const email = toEmail(identifier);
    const userMetadata = { name: fullName || email };
    if (frcTeam && !(await competitionTeams()).includes(frcTeam))
      return json({ error: 'Pick a team from Team settings, or Mentor.' }, { status: 400 });

    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata
    });

    if (error) {
      const message = /already|registered|duplicate|exists/i.test(error.message || '')
        ? 'An account with that username or email already exists.'
        : error.message || 'Could not create the account.';
      return json({ error: message }, { status: 400 });
    }

    const userId = data?.user?.id || null;
    if (userId) {
      const { error: approveError } = await db
        .from('user_profiles')
        .update({
          full_name: fullName || email,
          frc_team: frcTeam || null,
          general_role: 'member',
          permissions: ['CAN_SEE_ROUTES'],
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);
      if (approveError) return json({ error: `Created, but not approved: ${approveError.message}` }, { status: 500 });
    }
    return json({ success: true, data: { id: userId, email } });
  },
  'add-manual-team': async ({ db, body, actorId }) => {
    const teamKey = normalizeTeamKey(body?.team_key);
    if (!teamKey) return json({ error: 'A valid team number is required (e.g. 254 or frc254)' }, { status: 400 });

    const { data: existing, error: fetchError } = await db
      .from('scouting_settings')
      .select('manual_teams')
      .eq('id', 1)
      .maybeSingle();
    if (fetchError) return json({ error: fetchError.message }, { status: 500 });

    const current = Array.isArray(existing?.manual_teams) ? existing.manual_teams : [];
    const next = current.includes(teamKey) ? current : [...current, teamKey].sort(teamKeySort);

    const { data, error } = await db
      .from('scouting_settings')
      .upsert(
        { id: 1, manual_teams: next, updated_by: actorId, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select('manual_teams')
      .single();

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: { manual_teams: [...(data?.manual_teams || next)].sort(teamKeySort) } });
  },
  'remove-manual-team': async ({ db, body, actorId }) => {
    const teamKey = normalizeTeamKey(body?.team_key);
    if (!teamKey) return json({ error: 'A valid team number is required' }, { status: 400 });

    const { data: existing, error: fetchError } = await db
      .from('scouting_settings')
      .select('manual_teams')
      .eq('id', 1)
      .maybeSingle();
    if (fetchError) return json({ error: fetchError.message }, { status: 500 });

    const current = Array.isArray(existing?.manual_teams) ? existing.manual_teams : [];
    const next = current.filter((t) => t !== teamKey);

    const { data, error } = await db
      .from('scouting_settings')
      .upsert(
        { id: 1, manual_teams: next, updated_by: actorId, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      .select('manual_teams')
      .single();

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: { manual_teams: [...(data?.manual_teams || next)].sort(teamKeySort) } });
  },
  'delete-all-scouting-data': async ({ db, body, actorId, profile }) => {
    if (!isFullAdmin(profile)) {
      return json({ error: 'Only a full platform admin may delete scouting data.' }, { status: 403 });
    }
    let targetEventKey = null;
    if (body?.event_key !== undefined) {
      targetEventKey = normalizeEventCode(body.event_key);
      if (!targetEventKey) {
        return json({ error: 'A valid event_key is required to delete scouting data.' }, { status: 400 });
      }
    } else {
      const settings = await getScoutingSettings(db);
      targetEventKey = normalizeEventCode(settings?.event_key);
      if (!targetEventKey) {
        return json({ error: 'An active event_key is required to delete scouting data.' }, { status: 400 });
      }
    }

    const cleared = await clearAllScoutingData(db, targetEventKey, { actorId });
    return json({
      success: true,
      data: cleared
    });
  },
  'ban-and-revoke-user': async ({ db, body, profile }) => {
    if (!isFullAdmin(profile)) {
      return json({ error: 'Only an admin may ban users and revoke sessions.' }, { status: 403 });
    }
    const targetId = String(body?.target_user_id || '').trim();
    if (!targetId) return json({ error: 'target_user_id is required' }, { status: 400 });
    const { data: targetProfile } = await db
      .from('user_profiles')
      .select('id, role, is_dev, banned')
      .eq('id', targetId)
      .maybeSingle();
    if (targetProfile?.is_dev && !profile?.is_dev) {
      return json({ error: 'Only a developer account may ban another developer.' }, { status: 403 });
    }
    const { data: bannedUser, error: banErr } = await db
      .from('user_profiles')
      .update({ banned: true })
      .eq('id', targetId)
      .select('id, banned')
      .single();
    if (banErr) return json({ error: banErr.message }, { status: 500 });
    try {
      await db.auth?.admin?.signOut?.(targetId, 'global');
    } catch {
      // best-effort session revocation
    }
    return json({ success: true, data: bannedUser });
  },
  // Accounts start pending (handle_new_user). Approving one lets it see the scouting data; taking approval away
  // hides it again without banning. Admins and the Competition Lead only.
  'approve-user': async ({ db, body, actorId, profile }) => {
    if (!isFullAdmin(profile))
      return json({ error: 'Only an admin or the Competition Lead can approve accounts.' }, { status: 403 });
    const targetId = String(body?.target_user_id || '').trim();
    if (!targetId) return json({ error: 'target_user_id is required' }, { status: 400 });
    const approved = body?.approved !== false;
    const { data: target } = await db
      .from('user_profiles')
      .select('id, role, is_dev, permissions')
      .eq('id', targetId)
      .maybeSingle();
    if (!target) return json({ error: 'No such user.' }, { status: 404 });
    if (!approved && (target.role === 'admin' || target.is_dev || targetId === actorId))
      return json({ error: 'Admins and your own account stay approved.' }, { status: 400 });
    const others = (Array.isArray(target.permissions) ? target.permissions : []).filter((p) => p !== 'CAN_SEE_ROUTES');
    const { data, error } = await db
      .from('user_profiles')
      .update({
        general_role: approved ? 'member' : 'none',
        permissions: approved ? [...others, 'CAN_SEE_ROUTES'] : others,
        updated_at: new Date().toISOString()
      })
      .eq('id', targetId)
      .select('id, permissions')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: { id: data.id, approved } });
  },
  'set-user-password': async ({ db, body, profile }) => {
    if (!isFullAdmin(profile))
      return json({ error: 'Only an admin or the Competition Lead can set passwords.' }, { status: 403 });
    const targetId = String(body?.target_user_id || '').trim();
    const password = String(body?.password ?? '');
    if (!targetId) return json({ error: 'target_user_id is required' }, { status: 400 });
    if (password.length < 8) return json({ error: 'Use a password of at least 8 characters.' }, { status: 400 });
    const { data: target } = await db.from('user_profiles').select('id, role, is_dev').eq('id', targetId).maybeSingle();
    if (!target) return json({ error: 'No such user.' }, { status: 404 });
    if (target.is_dev && !profile?.is_dev)
      return json({ error: 'Only a developer account may change a developer password.' }, { status: 403 });
    if (target.role === 'admin' && profile?.role !== 'admin')
      return json({ error: 'Only an admin can change an admin password.' }, { status: 403 });
    const { error } = await db.auth.admin.updateUserById(targetId, { password });
    if (error) return json({ error: error.message }, { status: 500 });
    // Sign them out everywhere, so whoever had the old password loses access.
    await Promise.resolve(db.auth?.admin?.signOut?.(targetId, 'global')).catch(() => {});
    return json({ success: true });
  },
  'set-admin': async ({ db, body, actorId, profile }) => {
    if (profile?.role !== 'admin' || profile?.banned)
      return json({ error: 'Only an admin can make or remove admins.' }, { status: 403 });
    const targetId = String(body?.target_user_id || '').trim();
    if (!targetId) return json({ error: 'target_user_id is required' }, { status: 400 });
    if (targetId === actorId) return json({ error: 'You cannot change your own admin role.' }, { status: 400 });
    const admin = body?.admin === true;
    const { data: target } = await db
      .from('user_profiles')
      .select('id, is_dev, permissions')
      .eq('id', targetId)
      .maybeSingle();
    if (!target) return json({ error: 'No such user.' }, { status: 404 });
    if (target.is_dev && !profile?.is_dev)
      return json({ error: 'Only a developer account may modify a developer profile.' }, { status: 403 });
    const permissions = Array.isArray(target.permissions) ? target.permissions : [];
    const { error } = await db
      .from('user_profiles')
      .update({
        role: admin ? 'admin' : 'member',
        // An admin is approved; taking admin away leaves the account approved.
        permissions: permissions.includes('CAN_SEE_ROUTES') ? permissions : [...permissions, 'CAN_SEE_ROUTES'],
        general_role: admin ? 'lead' : 'member',
        updated_at: new Date().toISOString()
      })
      .eq('id', targetId);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: { id: targetId, admin } });
  },
  'update-scout-name': async ({ db, body, profile }) => {
    const targetId = String(body.target_user_id || '').trim();
    const name = String(body.full_name || '').trim();
    if (!targetId || !name || name.length > 120 || name.includes('@'))
      return json({ error: 'Enter a real name of 1–120 characters, not an email.' }, { status: 400 });
    const { data: targetProfile } = await db
      .from('user_profiles')
      .select('id, role, is_dev')
      .eq('id', targetId)
      .maybeSingle();
    if (targetProfile?.is_dev && !profile?.is_dev) {
      return json({ error: 'Only a developer account may modify a developer profile.' }, { status: 403 });
    }
    if (targetProfile?.role === 'admin' && !isFullAdmin(profile)) {
      return json({ error: 'Only an admin may rename an admin account.' }, { status: 403 });
    }
    const { data, error } = await db
      .from('user_profiles')
      .update({ full_name: name })
      .eq('id', targetId)
      .select('id, full_name')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  },
  'create-start-photo-upload': async ({ db, body }) => {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[body.content_type];
    if (!extension || !Number.isInteger(body.size) || body.size <= 0 || body.size > 5 * 1024 * 1024)
      return json({ error: 'Use a JPEG, PNG, or WebP image up to 5 MiB.' }, { status: 400 });
    const path = `match-starts/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await db.storage.from(PIT_SCOUT_PHOTO_BUCKET).createSignedUploadUrl(path);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  },
  'save-start-photo': async ({ db, body, actorId }) => {
    const positions = ['left trench', 'left mound', 'center', 'right mound', 'right trench'];
    if (
      !['red', 'blue'].includes(body.alliance) ||
      !positions.includes(body.position) ||
      !/^match-starts\/[a-f0-9-]+\.(jpg|png|webp)$/.test(body.path || '')
    )
      return json({ error: 'Invalid start-photo selection.' }, { status: 400 });
    const filename = body.path.split('/')[1];
    const { data: files, error: listError } = await db.storage
      .from(PIT_SCOUT_PHOTO_BUCKET)
      .list('match-starts', { search: filename });
    const file = files?.find((row) => row.name === filename);
    const size = Number(file?.metadata?.size);
    if (listError || !file || !Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024)
      return json({ error: 'Upload a valid photo before saving it.' }, { status: 400 });
    const { data: settings, error: readError } = await db
      .from('scouting_settings')
      .select('start_position_photos')
      .eq('id', 1)
      .maybeSingle();
    if (readError) return json({ error: readError.message }, { status: 500 });
    const photos = { ...(settings?.start_position_photos || {}), [`${body.alliance}:${body.position}`]: body.path };
    const { error } = await db
      .from('scouting_settings')
      .upsert(
        { id: 1, start_position_photos: photos, updated_by: actorId, updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true });
  },
  'update-competition-roles': async ({ db, body, actorId, profile }) => {
    const targetUserId = String(body?.target_user_id || '').trim();
    const rawRoles = body?.competition_roles;
    const frcTeamRaw = body?.frc_team;
    const frcTeam = frcTeamRaw === null || frcTeamRaw === '' ? null : String(frcTeamRaw).trim();

    if (!targetUserId) return json({ error: 'target_user_id is required' }, { status: 400 });
    if (!Array.isArray(rawRoles) || rawRoles.some((role) => !COMPETITION_ROLES.includes(String(role)))) {
      return json({ error: 'Invalid competition_roles' }, { status: 400 });
    }
    const nextRoles = orderCompetitionRoles(rawRoles);
    if (frcTeam !== null && !(await competitionTeams()).includes(frcTeam))
      return json({ error: 'Invalid frc_team' }, { status: 400 });

    const [{ data: targetProfile }, competitionTeamRes] = await Promise.all([
      db.from('user_profiles').select('id, role, is_dev, frc_team').eq('id', targetUserId).maybeSingle(),
      db.from('competition_team_members').select('frc_team').eq('user_id', targetUserId).maybeSingle()
    ]);
    if (!targetProfile) return json({ error: 'No such user.' }, { status: 404 });
    const currentTeam = competitionTeamRes?.data?.frc_team || targetProfile.frc_team || null;

    if (targetProfile.is_dev && !profile?.is_dev) {
      return json({ error: 'Only a developer account may modify a developer profile.' }, { status: 403 });
    }
    if (targetProfile.role === 'admin' && !isFullAdmin(profile)) {
      return json({ error: 'Only an admin or Competition Lead may modify an admin profile.' }, { status: 403 });
    }
    if (frcTeam === MENTOR_TEAM && !isFullAdmin(profile) && currentTeam !== MENTOR_TEAM) {
      return json({ error: 'Only an admin or Competition Lead may assign the Mentor affiliation.' }, { status: 403 });
    }

    const roleKeyMap = await ensureCompetitionRoleKeys(db);
    const roleNameByKeyId = new Map([...roleKeyMap.values()].map((key) => [key.id, key.key_name]));
    const { data: existingEntries, error: existingError } = roleNameByKeyId.size
      ? await db
          .from('roster_entries')
          .select('id, key_id')
          .eq('user_id', targetUserId)
          .in('key_id', [...roleNameByKeyId.keys()])
      : { data: [], error: null };
    if (existingError) return json({ error: existingError.message }, { status: 500 });

    // Roles that carry Scouting Admin are handed out (and taken away) only by an admin or a Competition Lead.
    const currentRoles = new Set(
      (existingEntries || []).map((entry) => roleNameByKeyId.get(entry.key_id)).filter(Boolean)
    );
    const wanted = new Set(nextRoles);
    const changed = [...new Set([...currentRoles, ...wanted])].filter(
      (role) => currentRoles.has(role) !== wanted.has(role)
    );
    if (changed.some((role) => SCOUTING_ADMIN_ROLES.includes(role)) && !isFullAdmin(profile)) {
      return json({ error: 'Only an admin or Competition Lead may change lead roles.' }, { status: 403 });
    }
    const missingKey = nextRoles.find((role) => !roleKeyMap.get(role));
    if (missingKey) {
      return json(
        {
          error: `Missing roster key for role "${missingKey}". Open Scouting Admin > People once so the role keys are created, then try again.`
        },
        { status: 400 }
      );
    }

    const toDelete = (existingEntries || []).filter((entry) => !wanted.has(roleNameByKeyId.get(entry.key_id)));
    if (toDelete.length) {
      const { error } = await db
        .from('roster_entries')
        .delete()
        .in(
          'id',
          toDelete.map((entry) => entry.id)
        );
      if (error) return json({ error: error.message }, { status: 500 });
    }
    const toInsert = nextRoles.filter((role) => !currentRoles.has(role)).map((role) => roleKeyMap.get(role));
    if (toInsert.length) {
      const { error } = await db
        .from('roster_entries')
        .insert(toInsert.map((key) => ({ roster_id: key.roster_id, user_id: targetUserId, key_id: key.id })));
      if (error) return json({ error: error.message }, { status: 500 });
    }

    // The team applies to this competition only; the profile's own frc_team is left alone.
    // Clearing it drops the override, so the person shows their profile team again.
    const teamWrite = frcTeam
      ? await db
          .from('competition_team_members')
          .upsert(
            { user_id: targetUserId, frc_team: frcTeam, updated_by: actorId, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          )
      : await db.from('competition_team_members').delete().eq('user_id', targetUserId);
    if (teamWrite.error) return json({ error: teamWrite.error.message }, { status: 500 });

    return json({
      success: true,
      data: {
        id: targetUserId,
        frc_team: frcTeam || targetProfile.frc_team || null,
        competition_roles: nextRoles
      }
    });
  }
};

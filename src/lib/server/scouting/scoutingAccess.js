// Who the caller is and what they may do, for API routes. Every route reads the caller's
// profile and roster keys through here instead of keeping its own copy.
//
// Two approval rules exist on purpose:
// - isApprovedProfile: an approved team member (admin, CAN_SEE_ROUTES, or a member/lead general role).
// - canSeeScoutingRoutes: the full permission model (hasPermission CAN_SEE_ROUTES, which also counts
//   team roles, roster keys and Competition Lead). Used by the scouting form APIs.
// Two Scouting Admin rules exist too:
// - canAdministerFrom (scouting setup, match reports, assignments): an admin, a competition lead or a competition
//   role carrying Scouting Admin. Someone whose access comes from a role (Scouting Admin > People > Roles) passes a
//   specific check instead: canAdministerOr(profile, rosterKeys, 'EDIT_FORMS'), or actorFor's can('EDIT_FORMS').
// - canManageScoutingAdmin (the /api/scouting-admin dashboard and its actions: users, data reset,
//   roles): only an admin, a competition lead or a competition role carrying Scouting Admin.
import { hasScoutingAdmin, holdsScoutingAdminRole, isCompetitionLead } from '$lib/scouting/competitionRoles.js';
import { hasPermission } from '$lib/app/permissions.js';
import { normalizeEventCode } from '$lib/scouting/eventCode.js';
import { clientFromRequest, dbClient, querySingle, unwrapSingle } from '$lib/server/supabaseClients.js';

export { clientFromRequest, dbClient, unwrapSingle };

export const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
export const normalizePerms = (value) => (Array.isArray(value) ? value.map(String) : value ? [String(value)] : []);

export function isApprovedProfile(profile) {
  if (!profile || profile.banned === true) return false;
  const permissions = new Set(normalizePerms(profile.permissions));
  const generalRole = normalizeKey(profile.general_role);
  return (
    profile.role === 'admin' ||
    permissions.has('CAN_SEE_ROUTES') ||
    generalRole === 'member' ||
    generalRole === 'subsystem_lead' ||
    generalRole === 'lead'
  );
}

export function canSeeScoutingRoutes(profile, rosterKeys = []) {
  if (!profile || profile.banned === true) return false;
  if (profile.role === 'admin') return true;
  if (Array.isArray(profile.permissions) && profile.permissions.includes('CAN_SEE_ROUTES')) return true;
  return hasPermission({ ...profile, roster_keys: rosterKeys }, 'CAN_SEE_ROUTES');
}

export function canAdministerFrom(profile, rosterKeys) {
  if (!profile || profile.banned === true) return false;
  return profile?.role === 'admin' || isCompetitionLead(profile, rosterKeys) || holdsScoutingAdminRole(rosterKeys);
}

/** A full scouting admin, or someone whose role carries `permission`. */
export function canAdministerOr(profile, rosterKeys, permission) {
  if (!profile || profile.banned === true) return false;
  return canAdministerFrom(profile, rosterKeys) || normalizePerms(profile.permissions).includes(permission);
}

/** The /api/scouting-admin rule: an admin, a competition lead, or a competition role carrying Scouting Admin. */
export function canManageScoutingAdmin(profile, rosterKeys) {
  return hasScoutingAdmin(profile, rosterKeys);
}

/** Roster key names a user holds ([] on any error). */
export async function fetchRosterKeys(db, userId) {
  if (!userId) return [];
  const { data, error } = await db.from('roster_entries').select('key:key_id(key_name)').eq('user_id', userId);
  if (error) return [];
  return (data || [])
    .map((row) => row?.key?.key_name)
    .filter(Boolean)
    .map(String);
}

/**
 * The caller's id and a minimal profile (role, permissions, team role, banned, is_dev), read with their own
 * client. With `rosterDb`, their roster keys are read from it at the same time.
 */
export async function fetchActorProfile(client, { rosterDb = null } = {}) {
  const { data: authRes } = await client.auth.getUser();
  const actorId = authRes?.user?.id || null;
  if (!actorId) return { actorId: null, profile: null, rosterKeys: [] };
  const [{ data: row }, rosterKeys] = await Promise.all([
    client.from('user_profiles').select('id, role, permissions, team_role, banned, is_dev').eq('id', actorId).single(),
    rosterDb ? fetchRosterKeys(rosterDb, actorId) : []
  ]);
  return {
    actorId,
    rosterKeys,
    profile: {
      id: actorId,
      role: row?.role || 'member',
      permissions: normalizePerms(row?.permissions),
      team_role: row?.team_role || null,
      banned: row?.banned === true,
      is_dev: row?.is_dev === true
    }
  };
}

/** One user's profile (the given columns) and roster keys, read together. Failures read as no profile / no keys. */
async function loadProfileAndRoster(db, userId, columns) {
  const [profileRes, rosterRes] = await Promise.all([
    Promise.resolve(querySingle(db.from('user_profiles').select(columns).eq('id', userId))).catch(() => ({
      data: null
    })),
    Promise.resolve(db.from('roster_entries').select('key:key_id(key_name)').eq('user_id', userId)).catch(() => ({
      data: []
    }))
  ]);
  const rosterKeys = Array.isArray(rosterRes?.data)
    ? rosterRes.data.map((row) => row?.key?.key_name || row?.key_name).filter(Boolean)
    : [];
  return { profile: unwrapSingle(profileRes?.data), rosterKeys };
}

// { actorId, canAdminister, approved, ... } for the signed-in caller.
// actorId is null (and db falls back to the caller's request-scoped client)
// when not signed in, not yet approved, or banned.
export async function actorFor(request) {
  const authed = clientFromRequest(request);
  const serviceDb = dbClient(authed);
  const { data } = await authed.auth.getUser();
  const user = data?.user || null;
  const rawActorId = user?.id || null;
  if (!rawActorId) {
    return {
      actorId: null,
      authenticatedUserId: null,
      user: null,
      profile: null,
      rosterKeys: [],
      approved: false,
      canAdminister: false,
      client: authed,
      db: authed
    };
  }
  const { profile, rosterKeys } = await loadProfileAndRoster(
    serviceDb,
    rawActorId,
    'id, role, permissions, general_role, team_role, banned, full_name, email'
  );
  const approved = isApprovedProfile(profile);
  const canAdminister = approved && canAdministerFrom(profile, rosterKeys);
  const can = (permission) => approved && canAdministerOr(profile, rosterKeys, permission);
  return {
    actorId: approved ? rawActorId : null,
    authenticatedUserId: rawActorId,
    user: approved ? user : null,
    profile,
    rosterKeys,
    approved,
    canAdminister,
    can,
    client: authed,
    db: approved ? serviceDb : authed
  };
}

export async function requireApprovedUser(request) {
  const access = await actorFor(request);
  if (!access.authenticatedUserId) {
    return { ...access, ok: false, status: 401, error: 'Unauthorized' };
  }
  if (!access.approved) {
    return { ...access, ok: false, status: 403, error: 'Forbidden' };
  }
  return { ...access, ok: true, status: 200, error: null };
}

/**
 * The scouting form APIs' gate (Data, Note, Pit Scout, picklist): signed in and canSeeScoutingRoutes.
 * Returns { ok, status, error, authSupa, db, actor, profile, rosterKeys }; db is the service client
 * when the caller passes, otherwise their own.
 */
export async function requireScoutingActor(request) {
  const authSupa = clientFromRequest(request);
  const { data: authData } = await authSupa.auth.getUser();
  const actor = authData?.user || null;
  if (!actor?.id) {
    return { ok: false, status: 401, error: 'Unauthorized', authSupa, db: authSupa, actor: null };
  }

  const db = dbClient(authSupa);
  const { profile, rosterKeys } = await loadProfileAndRoster(
    db,
    actor.id,
    'id, role, general_role, team_role, permissions, banned'
  );

  if (!canSeeScoutingRoutes(profile, rosterKeys)) {
    return { ok: false, status: 403, error: 'Forbidden', authSupa, db: authSupa, actor: null };
  }

  return { ok: true, status: 200, error: null, authSupa, db, actor, profile, rosterKeys };
}

/**
 * The event a scouting request is about: the given event key, else the match key's event, else the
 * active event in scouting_settings, else `fallbackEventKey`. Returns { eventKey, error }.
 */
export async function resolveEventKey(db, rawEventKey, { matchKey = '', fallbackEventKey = '' } = {}) {
  const trimmed = String(rawEventKey ?? '').trim();
  if (trimmed) {
    const clean = normalizeEventCode(trimmed);
    if (!clean) return { eventKey: null, error: 'Invalid event_key' };
    return { eventKey: clean, error: null };
  }

  const matchTrimmed = String(matchKey ?? '').trim();
  if (matchTrimmed) {
    const fromMatch = normalizeEventCode(matchTrimmed.split('_')[0]);
    if (fromMatch) return { eventKey: fromMatch, error: null };
    return { eventKey: null, error: 'Invalid match_key' };
  }

  try {
    const { data: settings } = await querySingle(db.from('scouting_settings').select('event_key').eq('id', 1));
    const active = normalizeEventCode(settings?.event_key);
    if (active) return { eventKey: active, error: null };
  } catch {
    // ignore fallback lookup failure
  }

  const fallback = normalizeEventCode(fallbackEventKey);
  if (fallback) return { eventKey: fallback, error: null };
  return { eventKey: null, error: 'event_key required' };
}

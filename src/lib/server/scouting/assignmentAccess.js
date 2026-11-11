// Who may publish and who may be given scouting assignments (match, pre-scout and pit), shared by
// the three assignment APIs. Pit and pre-scouting have no roster role of their own, so they reuse
// Data Scout's admin/lead/member recognition (canEditData / canAssignData), the same way Quick Scout does.
import { holdsScoutingAdminRole, isCompetitionLead, isScoutEligibleKey } from '$lib/scouting/competitionRoles.js';
import { assignmentKind } from '$lib/scouting/myAssignments.js';
import { clientFromRequest, dbClient } from '$lib/server/supabaseClients.js';
import { fetchActorProfile, normalizeKey, normalizePerms } from '$lib/server/scouting/scoutingAccess.js';

// A banned caller can't publish or be assigned anything, whatever roles or keys they still hold.
const NO_ACCESS = Object.freeze({
  canEditData: false,
  canEditNote: false,
  canEditQuick: false,
  canAssignData: false,
  canAssignNote: false,
  canAssignQuick: false
});

export function computeAssignmentAccess(profile, rosterKeys) {
  if (profile?.banned === true) return { ...NO_ACCESS, rosterKeys: [] };
  const perms = new Set(normalizePerms(profile?.permissions));
  const keys = new Set((rosterKeys || []).map(normalizeKey).filter(Boolean));
  const isAdmin = profile?.role === 'admin';
  const isLead = isCompetitionLead(profile, rosterKeys);
  const hasLeadKey = holdsScoutingAdminRole(rosterKeys);
  const hasMemberKey = [...keys].some(isScoutEligibleKey) || hasLeadKey;

  // A role carries assignment editing explicitly ("Manage match assignments" = DATA_SCOUT_ADMIN, "Manage note and
  // pit assignments" = NOTE_SCOUT_ADMIN); opening Scouting Admin alone does not.
  const canEditData = isAdmin || isLead || perms.has('DATA_SCOUT_ADMIN') || hasLeadKey;
  const canEditNote = isAdmin || isLead || perms.has('NOTE_SCOUT_ADMIN') || hasLeadKey;
  // Quick Scout is a lighter-weight mode of the same data-scouting role, not a
  // separate team function - reuse Data Scout's eligibility/roster keys.
  const canEditQuick = canEditData;
  const canAssignData = canEditData || perms.has('DATA_SCOUT_MEMBER') || hasMemberKey;

  return {
    canEditData,
    canEditNote,
    canEditQuick,
    canAssignData,
    canAssignNote: canEditNote || perms.has('DATA_SCOUT_MEMBER') || hasMemberKey,
    canAssignQuick: canAssignData,
    rosterKeys: [...keys]
  };
}

/** The signed-in caller for an assignment API: { authSupa, db, actorId, profile, rosterKeys, access }. */
export async function assignmentContext(request) {
  const authSupa = clientFromRequest(request);
  const db = dbClient(authSupa);
  const { actorId, profile, rosterKeys } = await fetchActorProfile(authSupa, { rosterDb: db });
  return { authSupa, db, actorId, profile, rosterKeys, access: computeAssignmentAccess(profile, rosterKeys) };
}

/**
 * Everyone who can be given a scouting assignment (a scout-eligible roster key, not banned), sorted by name.
 * `withReportKind` adds each person's match report kind (data, performance or robot) from their roster keys.
 */
export async function listEligibleScouts(db, { withReportKind = false } = {}) {
  const { data, error } = await db
    .from('roster_entries')
    .select('user_id, key:key_id(key_name), user:user_id(id, full_name, email, banned)');
  if (error) throw error;

  const users = new Map();
  const keysByUser = new Map();
  for (const row of data || []) {
    const user = row?.user;
    if (!user?.id) continue;
    if (!keysByUser.has(user.id)) keysByUser.set(user.id, []);
    if (row?.key?.key_name) keysByUser.get(user.id).push(String(row.key.key_name));
    if (!isScoutEligibleKey(row?.key?.key_name) || user.banned) continue;
    if (!users.has(user.id))
      users.set(user.id, { id: user.id, full_name: user.full_name || null, email: user.email || null });
  }
  if (withReportKind) for (const [id, entry] of users) entry.report_kind = assignmentKind(keysByUser.get(id));

  return [...users.values()].sort((a, b) =>
    (a.full_name || a.email || '').toLowerCase().localeCompare((b.full_name || b.email || '').toLowerCase())
  );
}

// Competition roles: roster keys in the "Competition Roles" roster, assigned on the
// Scouting Admin > People page. A person can hold several (Drive Coach and Competition Lead,
// say). The scout keys keep their old "... Scout Member" names because the Match Scouting
// tabs are picked from them (see reportKinds.js).
import { MATCH_SCOUT_MEMBER_KEYS } from '$lib/scouting/reportKinds.js';

export const COMPETITION_ROLE_GROUPS = Object.freeze([
  { label: 'Leadership', roles: ['Competition Lead', 'Strat Coach', 'Drive Team Mentor'] },
  { label: 'Drive Team', roles: ['Driver', 'Manipulator', 'Human Player', 'Technician', 'Drive Coach', 'Drive Team'] },
  {
    label: 'Pit Crew',
    roles: ['Pit Lead', 'Mechanical Pit', 'Electrical Pit', 'Software Pit', 'Pit Coach', 'Pit Mentor']
  },
  { label: 'Strategy', roles: ['Strategy Lead', 'Strategy Team', 'Match Recording'] },
  { label: 'Picklist', roles: ['Picklist 1 Lead', 'Picklist 2 Lead', 'Picklist Team'] },
  { label: 'Scouting', roles: ['Scouting Lead', 'Data Scout Member', 'Performance Scout Member', 'Robot Scout Member'] }
]);

export const COMPETITION_ROLES = Object.freeze(COMPETITION_ROLE_GROUPS.flatMap((group) => group.roles));

export const COMPETITION_LEAD_ROLE = 'Competition Lead';

// Roles that carry Scouting Admin. Scouting Lead replaced the old separate Scouting Admin role.
export const SCOUTING_ADMIN_ROLES = Object.freeze([
  COMPETITION_LEAD_ROLE,
  'Scouting Lead',
  'Strategy Lead',
  'Pit Lead',
  'Picklist 1 Lead',
  'Picklist 2 Lead'
]);

const ROLE_LABELS = Object.freeze({
  'Data Scout Member': 'Data Scout',
  'Performance Scout Member': 'Performance Scout',
  'Robot Scout Member': 'Robot Scout'
});

export const competitionRoleLabel = (role) => ROLE_LABELS[role] || String(role || '');

const lower = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const keySet = (rosterKeys) => new Set((rosterKeys || []).map(lower).filter(Boolean));

const SCOUTING_ADMIN_KEYS = new Set(SCOUTING_ADMIN_ROLES.map(lower));

// The "Competition Lead" team role on the profile counts too, as well as the roster key.
export function isCompetitionLead(profile, rosterKeys = profile?.roster_keys) {
  if (!profile || profile.banned === true) return false;
  return (
    lower(profile.team_role) === lower(COMPETITION_LEAD_ROLE) || keySet(rosterKeys).has(lower(COMPETITION_LEAD_ROLE))
  );
}

export function holdsScoutingAdminRole(rosterKeys) {
  for (const key of keySet(rosterKeys)) if (SCOUTING_ADMIN_KEYS.has(key)) return true;
  return false;
}

/**
 * Who can use Scouting Admin: an admin, the Competition Lead (roster key or team role), or someone holding a
 * role that carries Scouting Admin. A banned person never can. The API (canManageScoutingAdmin) and the
 * People tab's checkmark both use this.
 */
export function hasScoutingAdmin(profile, rosterKeys = profile?.roster_keys) {
  if (!profile || profile.banned) return false;
  return profile.role === 'admin' || isCompetitionLead(profile, rosterKeys) || holdsScoutingAdminRole(rosterKeys);
}

/** Sorts role names into the order of COMPETITION_ROLES, dropping unknown ones and duplicates. */
export function orderCompetitionRoles(roles) {
  const wanted = new Set((roles || []).map(String));
  return COMPETITION_ROLES.filter((role) => wanted.has(role));
}

const SCOUT_ELIGIBLE_KEYS = new Set([...MATCH_SCOUT_MEMBER_KEYS, lower('Scouting Lead')]);

/** Whether a roster key puts someone in the pool for match, quick, note, pit and prescout assignments. */
export const isScoutEligibleKey = (keyName) => SCOUT_ELIGIBLE_KEYS.has(lower(keyName));

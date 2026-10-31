// Who may do what. An account starts pending (general_role 'none', no permissions) and sees nothing until an
// admin approves it, which gives it CAN_SEE_ROUTES. Competition roles (roster keys like "Scouting Lead", see
// src/lib/scouting/competitionRoles.js) add the scouting admin permissions on top.
import { SCOUTING_ADMIN_ROLES, isCompetitionLead } from '$lib/scouting/competitionRoles.js';

export const PERMISSIONS = [
  'CAN_SEE_ROUTES', // approved: can use the app
  'APPROVE_USERS',
  'PROMOTE_USERS',
  'EDIT_PERMISSIONS',
  'BAN_USERS',
  'VIEW_ADMIN_PANEL',
  'NOTE_SCOUT_ADMIN', // can manage note scouting assignments
  'DATA_SCOUT_ADMIN', // can manage match scouting assignments
  'DATA_SCOUT_MEMBER', // can be assigned match scouting
  'VIDEO_SCOUT_MEMBER'
];

export const GENERAL_ROLES = {
  NONE: 'none',
  MEMBER: 'member',
  SUBSYSTEM_LEAD: 'subsystem_lead',
  LEAD: 'lead'
};

export const TEAM_ROLES = {
  COMPETITION_LEAD: 'Competition Lead',
  SCOUTING_LEAD: 'Scouting Lead',
  OTHER: 'Other'
};

/** The non-team choice for "team this person competes for", alongside the team numbers from Team settings. */
export const MENTOR_TEAM = 'Mentor';

export const GENERAL_ROLE_PERMISSIONS = {
  [GENERAL_ROLES.NONE]: [],
  [GENERAL_ROLES.MEMBER]: ['CAN_SEE_ROUTES'],
  [GENERAL_ROLES.SUBSYSTEM_LEAD]: ['CAN_SEE_ROUTES'],
  [GENERAL_ROLES.LEAD]: ['CAN_SEE_ROUTES', 'VIEW_ADMIN_PANEL', 'PROMOTE_USERS', 'APPROVE_USERS', 'EDIT_PERMISSIONS']
};

const ROSTER_KEY_PERMISSIONS = {
  ...Object.fromEntries(SCOUTING_ADMIN_ROLES.map((role) => [role, ['DATA_SCOUT_ADMIN', 'NOTE_SCOUT_ADMIN']])),
  'Video Scout Member': ['VIDEO_SCOUT_MEMBER'],
  'Data Scout Member': ['DATA_SCOUT_MEMBER'],
  'Performance Scout Member': ['DATA_SCOUT_MEMBER'],
  'Robot Scout Member': ['DATA_SCOUT_MEMBER']
};

// Scouting Lead has no permissions of its own as a team role: scouting admin access comes from the
// competition-role roster keys. Competition Lead holds every permission in this app (see hasPermission).
export const TEAM_ROLE_PERMISSIONS = {
  [TEAM_ROLES.SCOUTING_LEAD]: [],
  [TEAM_ROLES.COMPETITION_LEAD]: []
};

export function getRoleDerivedPermissions({ general_role = GENERAL_ROLES.NONE, team_role, roster_keys = [] } = {}) {
  const derived = new Set();
  (GENERAL_ROLE_PERMISSIONS[general_role] || []).forEach((perm) => derived.add(perm));
  (TEAM_ROLE_PERMISSIONS[team_role] || []).forEach((perm) => derived.add(perm));
  if (Array.isArray(roster_keys)) {
    for (const key of roster_keys) (ROSTER_KEY_PERMISSIONS[key] || []).forEach((perm) => derived.add(perm));
  }
  return derived;
}

export function hasPermission(user, perm) {
  if (!user || user.banned) return false;
  if (user.role === 'admin') return true;
  // Competition Lead is the top competition role and holds every permission in this app.
  if (isCompetitionLead(user)) return true;
  const generalRole = user.general_role || GENERAL_ROLES.NONE;
  if (GENERAL_ROLE_PERMISSIONS[generalRole]?.includes(perm)) return true;
  if (user.team_role && TEAM_ROLE_PERMISSIONS[user.team_role]?.includes(perm)) return true;
  if (Array.isArray(user.roster_keys)) {
    for (const key of user.roster_keys) if (ROSTER_KEY_PERMISSIONS[key]?.includes(perm)) return true;
  }
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

// Developer accounts are a tier above admins: only another developer can change their roles or remove them.
// Nobody is a developer by default; set user_profiles.is_dev in the database if you want one.
export function isDev(user) {
  return Boolean(user?.is_dev && !user?.banned);
}

export function normalizePermissions(arr) {
  if (!arr) return [];
  if (Array.isArray(arr)) return arr.map(String);
  return [String(arr)];
}

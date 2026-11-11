// Roles and the permissions they carry. An admin builds roles out of the permissions below in Scouting Admin >
// People > Roles and gives each person one role; nobody gets a single permission on its own. Everyone without a role
// is a Member: once approved they can use the app, scout and read the analysis pages, and nothing more.
//
// A role's permissions are written into each holder's user_profiles.permissions (rolePermissionsForProfile), so the
// existing checks (hasPermission in permissions.js and the server's access helpers) read them unchanged.

/** Every permission a role can carry, grouped for the editor. `key` is what lands in user_profiles.permissions. */
export const PERMISSION_CATALOG = Object.freeze([
  {
    key: 'VIEW_ADMIN_PANEL',
    group: 'Scouting Admin',
    label: 'Open Scouting Admin',
    description: 'See the Scouting Admin pages and the event overview.'
  },
  {
    key: 'MANAGE_EVENT',
    group: 'Scouting Admin',
    label: 'Set up events',
    description: 'Choose the active event, create competition codes, add prescouting teams and starting photos.'
  },
  {
    key: 'DATA_SCOUT_ADMIN',
    group: 'Scouting Admin',
    label: 'Manage match assignments',
    description: 'Assign scouts to robots in each match and change those assignments.'
  },
  {
    key: 'NOTE_SCOUT_ADMIN',
    group: 'Scouting Admin',
    label: 'Manage note and pit assignments',
    description: 'Assign note scouting, prescouting and pit scouting.'
  },
  {
    key: 'EDIT_FORMS',
    group: 'Scouting Admin',
    label: 'Edit scouting forms',
    description: 'Add, reorder and rename questions on the match and pit scouting forms.'
  },
  {
    key: 'EDIT_TEAM_SETTINGS',
    group: 'Scouting Admin',
    label: 'Edit team settings',
    description: 'Change the team, the app name, colors, appearance, logo and which pages are in the menu.'
  },
  {
    key: 'APPROVE_USERS',
    group: 'People',
    label: 'Approve accounts',
    description: 'Let new accounts into the app.'
  },
  {
    key: 'BAN_USERS',
    group: 'People',
    label: 'Remove accounts',
    description: 'Ban an account and sign it out everywhere.'
  },
  {
    key: 'PROMOTE_USERS',
    group: 'People',
    label: 'Give people roles',
    description: 'Assign roles to people, and set their competition roles and team.'
  },
  {
    key: 'EDIT_PERMISSIONS',
    group: 'People',
    label: 'Create and edit roles',
    description: 'Create roles, change which permissions they carry, and delete them.'
  },
  {
    key: 'VIEW_ACTIVITY_LOG',
    group: 'People',
    label: 'See the activity log',
    description: 'Read the record of every change made in the app, and who made it.'
  },
  {
    key: 'EXPORT_DATA',
    group: 'Data',
    label: 'Export scouting data',
    description: 'Download the Excel and CSV exports and sync the Google Sheet.'
  },
  {
    key: 'REMOVE_REPORTS',
    group: 'Data',
    label: 'Remove scouting reports',
    description: "Delete anyone's match report and fix reports filed under the wrong match."
  },
  {
    key: 'DELETE_DATA',
    group: 'Data',
    label: 'Delete all scouting data',
    description: 'Wipe notes, assignments, data events and pit entries for the event.'
  },
  {
    key: 'DATA_SCOUT_MEMBER',
    group: 'Scouting',
    label: 'Be assigned match scouting',
    description: 'Show up as a scout in the match assignment board.'
  }
]);

export const PERMISSION_KEYS = Object.freeze(PERMISSION_CATALOG.map((permission) => permission.key));
const KNOWN = new Set(PERMISSION_KEYS);

/** What every approved account can do with no role. Not assignable: approval grants it. */
export const MEMBER_PERMISSIONS = Object.freeze(['CAN_SEE_ROUTES']);
export const MEMBER_ROLE_NAME = 'Member';

/** The permission groups in catalog order, each with its permissions. */
export function permissionGroups(catalog = PERMISSION_CATALOG) {
  const groups = new Map();
  for (const permission of catalog) {
    if (!groups.has(permission.group)) groups.set(permission.group, []);
    groups.get(permission.group).push(permission);
  }
  return [...groups].map(([group, permissions]) => ({ group, permissions }));
}

/** Permissions matching a search over label, description, group and key (all of them for an empty search). */
export function searchPermissions(query, catalog = PERMISSION_CATALOG) {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  if (!needle) return [...catalog];
  return catalog.filter((permission) =>
    [permission.label, permission.description, permission.group, permission.key].some((text) =>
      String(text).toLowerCase().includes(needle)
    )
  );
}

/**
 * Checks a role an admin submitted. Returns { value, error }: value has the columns to write. Unknown permission keys
 * are an error rather than silently dropped, so a typo never saves a weaker role than intended.
 */
export function validateRoleInput(input = {}) {
  const name = String(input.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!name) return { value: null, error: 'Give the role a name.' };
  if (name.length > 40) return { value: null, error: 'Role names are at most 40 characters.' };
  if (name.toLowerCase() === MEMBER_ROLE_NAME.toLowerCase())
    return { value: null, error: 'Member is the built-in role for everyone; pick another name.' };
  const description = String(input.description ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (description.length > 200) return { value: null, error: 'Descriptions are at most 200 characters.' };
  const permissions = [...new Set((Array.isArray(input.permissions) ? input.permissions : []).map(String))];
  const unknown = permissions.filter((key) => !KNOWN.has(key));
  if (unknown.length) return { value: null, error: `Unknown permission: ${unknown.join(', ')}.` };
  return {
    error: null,
    value: { name, description, permissions: PERMISSION_KEYS.filter((key) => permissions.includes(key)) }
  };
}

/**
 * The permissions column for someone holding `role` (null for Member). Approval (CAN_SEE_ROUTES) is kept as it was;
 * every other permission comes from the role alone, so taking a role away takes its permissions with it.
 */
export function rolePermissionsForProfile(currentPermissions, role) {
  const approved = (currentPermissions || []).includes('CAN_SEE_ROUTES');
  return [...(approved ? MEMBER_PERMISSIONS : []), ...(role?.permissions || []).filter((key) => KNOWN.has(key))];
}

/** Permissions in `wanted` that `granter` doesn't hold: a person can only hand out what they can do themselves. */
export function permissionsBeyond(granterPermissions, wanted, { isAdmin = false } = {}) {
  if (isAdmin) return [];
  const held = new Set(granterPermissions || []);
  return (wanted || []).filter((key) => !held.has(key));
}

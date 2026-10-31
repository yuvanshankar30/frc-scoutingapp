// Competition roles on Scouting Admin > People: the role keys on the scouting roster and who holds them.
import { COMPETITION_ROLES } from '$lib/scouting/competitionRoles.js';
import { COMPETITION_ROLE_GROUPS } from '$lib/scouting/competitionRoles.js';

export const ROLE_GROUP_BY_NAME = new Map(
  COMPETITION_ROLE_GROUPS.flatMap((group) => group.roles.map((role) => [role, group.label]))
);

export async function fetchCompetitionTeams(db) {
  try {
    const { data, error } = await db.from('competition_team_members').select('user_id, frc_team');
    if (error || !Array.isArray(data)) return new Map();
    return new Map(data.map((row) => [row.user_id, row.frc_team]));
  } catch {
    return new Map();
  }
}

export async function fetchCompetitionRoleKeys(db) {
  const { data, error } = await db
    .from('roster_keys')
    .select('id, roster_id, key_name')
    .in('key_name', COMPETITION_ROLES)
    .order('id', { ascending: true });

  if (error) throw error;

  const byName = new Map();
  for (const row of data || []) {
    const keyName = String(row?.key_name || '').trim();
    if (!keyName || byName.has(keyName)) continue;
    byName.set(keyName, {
      id: row.id,
      roster_id: row.roster_id,
      key_name: keyName
    });
  }

  return byName;
}

export async function findScoutingRosterId(db, existingRoleKeys = new Map()) {
  for (const row of existingRoleKeys.values()) {
    if (row?.roster_id) return row.roster_id;
  }

  const { data, error } = await db.from('rosters').select('id, name').order('id', { ascending: true });

  if (error) return null;
  const rows = data || [];
  const scoutingRoster =
    rows.find((r) =>
      String(r?.name || '')
        .toLowerCase()
        .includes('scouting')
    ) ||
    rows.find((r) =>
      String(r?.name || '')
        .toLowerCase()
        .includes('competition')
    ) ||
    rows[0];

  return scoutingRoster?.id || null;
}

export async function ensureCompetitionRoleKeys(db) {
  const byName = await fetchCompetitionRoleKeys(db);
  const missing = COMPETITION_ROLES.filter((name) => !byName.has(name));
  if (!missing.length) return byName;

  const rosterId = await findScoutingRosterId(db, byName);
  if (!rosterId) return byName;

  for (const keyName of missing) {
    const { error } = await db.from('roster_keys').insert([
      {
        roster_id: rosterId,
        key_name: keyName,
        category: ROLE_GROUP_BY_NAME.get(keyName) || 'Competition'
      }
    ]);

    if (error && error.code !== '23505') throw error;
  }

  return fetchCompetitionRoleKeys(db);
}

export async function fetchCompetitionRolesByUser(db, keyIds) {
  if (!keyIds.length) return new Map();
  const { data, error } = await db.from('roster_entries').select('user_id, key:key_id(key_name)').in('key_id', keyIds);

  if (error) throw error;

  const byUser = new Map();
  for (const row of data || []) {
    const userId = row?.user_id;
    const keyName = String(row?.key?.key_name || '').trim();
    if (!userId || !keyName) continue;
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId).add(keyName);
  }

  return byUser;
}

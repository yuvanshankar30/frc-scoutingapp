// A user's profile with their roster keys attached, ready for hasPermission. Roster keys
// matter because competition roles (Competition Lead above all) are roster keys.
export async function loadPermissionProfile(client, userId) {
  const [profileRes, rosterRes] = await Promise.all([
    client.from('user_profiles').select('role, permissions, banned, team_role').eq('id', userId).single(),
    (async () => client.from('roster_entries').select('key:key_id(key_name)').eq('user_id', userId))().catch(() => ({
      data: []
    }))
  ]);
  if (!profileRes?.data) return null;
  const rosterKeys = (Array.isArray(rosterRes?.data) ? rosterRes.data : [])
    .map((row) => row?.key?.key_name)
    .filter(Boolean);
  return { ...profileRes.data, roster_keys: rosterKeys };
}

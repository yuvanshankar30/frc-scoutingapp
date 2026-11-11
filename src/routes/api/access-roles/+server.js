// Scouting Admin > People > Roles: list, create, edit and delete roles, and give people a role.
// Reading needs an approved account; creating and editing roles needs EDIT_PERMISSIONS, giving someone a role needs
// PROMOTE_USERS. Admins and the Competition Lead hold every permission (hasPermission). Nobody can put a permission
// into a role, or give a role, carrying something they can't do themselves.
import { json } from '@sveltejs/kit';
import { requireApprovedUser } from '$lib/server/scouting/scoutingAccess.js';
import { getSupabase } from '$lib/server/serviceClient.js';
import { hasPermission } from '$lib/app/permissions.js';
import { isCompetitionLead } from '$lib/scouting/competitionRoles.js';
import {
  MEMBER_ROLE_NAME,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  permissionsBeyond,
  rolePermissionsForProfile,
  validateRoleInput
} from '$lib/app/accessRoles.js';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_COLUMNS = 'id, name, description, permissions, created_at, updated_at';

const fail = (error, status = 400) => json({ error }, { status, headers: NO_STORE });
const isMissingTable = (error) =>
  /access_roles|access_role_id/.test(error?.message || '') && /exist/.test(error?.message || '');
const MISSING = 'Roles need the 20260106000000_access_roles.sql migration on the database.';

function actorScope(access) {
  const user = { ...access.profile, roster_keys: access.rosterKeys };
  const isAdmin = access.profile?.role === 'admin' || isCompetitionLead(access.profile, access.rosterKeys);
  // What this person can hand out: everything for admins, otherwise the catalog permissions they hold.
  const held = isAdmin ? PERMISSION_KEYS : PERMISSION_KEYS.filter((key) => hasPermission(user, key));
  return { user, isAdmin, held };
}

export async function GET({ request }) {
  const access = await requireApprovedUser(request);
  if (!access.ok) return fail(access.error, access.status);
  const db = getSupabase();
  const [roles, people] = await Promise.all([
    db.from('access_roles').select(ROLE_COLUMNS).order('name'),
    db.from('user_profiles').select('id, full_name, email, access_role_id, banned').order('full_name')
  ]);
  if (roles.error) return fail(isMissingTable(roles.error) ? MISSING : roles.error.message, 500);
  if (people.error) return fail(isMissingTable(people.error) ? MISSING : people.error.message, 500);
  const { isAdmin, held, user } = actorScope(access);
  return json(
    {
      success: true,
      catalog: PERMISSION_CATALOG,
      memberRole: MEMBER_ROLE_NAME,
      roles: roles.data || [],
      people: (people.data || []).filter((person) => !person.banned),
      can: {
        editRoles: hasPermission(user, 'EDIT_PERMISSIONS'),
        assignRoles: hasPermission(user, 'PROMOTE_USERS'),
        viewActivity: hasPermission(user, 'VIEW_ACTIVITY_LOG'),
        grantable: isAdmin ? PERMISSION_KEYS : held
      }
    },
    { headers: NO_STORE }
  );
}

/** Rewrites the permissions of everyone holding `roleId` (or the given people) from the role. */
async function syncHolders(db, role, filter) {
  let query = db.from('user_profiles').select('id, permissions');
  query = filter.userId ? query.eq('id', filter.userId) : query.eq('access_role_id', role.id);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  for (const profile of data || []) {
    const permissions = rolePermissionsForProfile(profile.permissions, filter.clear ? null : role);
    const update = { permissions, updated_at: new Date().toISOString() };
    if (filter.userId) update.access_role_id = filter.clear ? null : role.id;
    const result = await db.from('user_profiles').update(update).eq('id', profile.id);
    if (result.error) throw new Error(result.error.message);
  }
}

export async function POST({ request }) {
  const access = await requireApprovedUser(request);
  if (!access.ok) return fail(access.error, access.status);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Invalid request');
  const { user, isAdmin, held } = actorScope(access);
  const db = getSupabase();
  const action = String(body.action || '');

  try {
    if (action === 'create' || action === 'update') {
      if (!hasPermission(user, 'EDIT_PERMISSIONS'))
        return fail('You need the "Create and edit roles" permission.', 403);
      const { value, error } = validateRoleInput(body.role);
      if (error) return fail(error);
      const beyond = permissionsBeyond(held, value.permissions, { isAdmin });
      if (beyond.length) return fail(`You can't give permissions you don't have: ${beyond.join(', ')}.`, 403);
      if (action === 'create') {
        const { data, error: insertError } = await db
          .from('access_roles')
          .insert({ ...value, created_by: access.actorId, updated_by: access.actorId })
          .select(ROLE_COLUMNS)
          .single();
        if (insertError)
          return fail(
            /duplicate|unique/i.test(insertError.message)
              ? 'A role with that name already exists.'
              : insertError.message,
            insertError.code === '23505' ? 409 : 500
          );
        return json({ success: true, role: data }, { headers: NO_STORE });
      }
      const id = String(body.role?.id || '');
      if (!UUID.test(id)) return fail('Invalid role');
      const { data, error: updateError } = await db
        .from('access_roles')
        .update({ ...value, updated_by: access.actorId, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(ROLE_COLUMNS)
        .single();
      if (updateError)
        return fail(
          /duplicate|unique/i.test(updateError.message) ? 'A role with that name already exists.' : updateError.message,
          500
        );
      await syncHolders(db, data, {});
      return json({ success: true, role: data }, { headers: NO_STORE });
    }

    if (action === 'delete') {
      if (!hasPermission(user, 'EDIT_PERMISSIONS'))
        return fail('You need the "Create and edit roles" permission.', 403);
      const id = String(body.id || '');
      if (!UUID.test(id)) return fail('Invalid role');
      const { data: role } = await db.from('access_roles').select(ROLE_COLUMNS).eq('id', id).maybeSingle();
      if (!role) return fail('That role no longer exists.', 404);
      // Holders become Members first, so no permission outlives the role that gave it.
      const { data: holders } = await db.from('user_profiles').select('id').eq('access_role_id', id);
      for (const holder of holders || []) await syncHolders(db, role, { userId: holder.id, clear: true });
      const { error } = await db.from('access_roles').delete().eq('id', id);
      if (error) return fail(error.message, 500);
      return json({ success: true }, { headers: NO_STORE });
    }

    if (action === 'assign') {
      if (!hasPermission(user, 'PROMOTE_USERS')) return fail('You need the "Give people roles" permission.', 403);
      const userId = String(body.user_id || '');
      if (!UUID.test(userId)) return fail('Invalid person');
      if (userId === access.actorId && !isAdmin) return fail("You can't change your own role.", 403);
      const roleId = body.role_id ? String(body.role_id) : '';
      if (roleId && !UUID.test(roleId)) return fail('Invalid role');
      const { data: target } = await db.from('user_profiles').select('id, role, is_dev').eq('id', userId).maybeSingle();
      if (!target) return fail('That person no longer exists.', 404);
      if (target.is_dev && !access.profile?.is_dev) return fail("Only a developer can change a developer's role.", 403);
      if (!roleId) {
        await syncHolders(db, { id: null, permissions: [] }, { userId, clear: true });
        return json({ success: true }, { headers: NO_STORE });
      }
      const { data: role } = await db.from('access_roles').select(ROLE_COLUMNS).eq('id', roleId).maybeSingle();
      if (!role) return fail('That role no longer exists.', 404);
      const beyond = permissionsBeyond(held, role.permissions, { isAdmin });
      if (beyond.length) return fail(`That role carries permissions you don't have: ${beyond.join(', ')}.`, 403);
      await syncHolders(db, role, { userId });
      return json({ success: true }, { headers: NO_STORE });
    }

    return fail('Invalid action');
  } catch (cause) {
    return fail(isMissingTable(cause) ? MISSING : cause?.message || 'Internal error', 500);
  }
}

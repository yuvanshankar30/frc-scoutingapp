// Scouting Admin > People > Activity: the record of changes the database keeps in activity_log (a trigger on every
// main table writes one row per insert, update and delete, with who made it). Needs VIEW_ACTIVITY_LOG; admins and the
// Competition Lead hold it. Answers are summaries: what changed, on what, by whom, and only the changed fields.
import { json } from '@sveltejs/kit';
import { requireApprovedUser } from '$lib/server/scouting/scoutingAccess.js';
import { getSupabase } from '$lib/server/serviceClient.js';
import { hasPermission } from '$lib/app/permissions.js';
import { describeActivity } from '$lib/app/activityLog.js';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const MAX_ROWS = 300;
const TABLE = /^[a-z_]{1,64}$/;

export async function GET({ request, url }) {
  const access = await requireApprovedUser(request);
  if (!access.ok) return json({ error: access.error }, { status: access.status, headers: NO_STORE });
  if (!hasPermission({ ...access.profile, roster_keys: access.rosterKeys }, 'VIEW_ACTIVITY_LOG'))
    return json({ error: 'You need the "See the activity log" permission.' }, { status: 403, headers: NO_STORE });

  const db = getSupabase();
  const table = String(url.searchParams.get('table') || '');
  const before = Number(url.searchParams.get('before') || 0);
  let query = db
    .from('activity_log')
    .select('id, table_name, operation, row_id, actor, changed_columns, old_data, new_data, created_at')
    .order('id', { ascending: false })
    .limit(MAX_ROWS);
  if (table && TABLE.test(table)) query = query.eq('table_name', table);
  if (Number.isInteger(before) && before > 0) query = query.lt('id', before);
  const { data, error } = await query;
  if (error) return json({ error: error.message }, { status: 500, headers: NO_STORE });

  const actorIds = [...new Set((data || []).map((row) => row.actor).filter(Boolean))];
  const names = new Map();
  if (actorIds.length) {
    const { data: people } = await db.from('user_profiles').select('id, full_name, email').in('id', actorIds);
    for (const person of people || []) names.set(person.id, person.full_name || person.email || 'Someone');
  }
  const entries = (data || []).map((row) => describeActivity(row, names));
  return json(
    { success: true, entries, more: (data || []).length === MAX_ROWS ? data.at(-1).id : null },
    { headers: NO_STORE }
  );
}

// Scouting Admin -> Data -> Storage.
// GET: sizes, limits and the cleanup plan (a dry run; nothing is deleted).
// POST { action: 'approve', plan_id }: recomputes the plan and deletes its items only when a limit is crossed and the
// plan is still the one the admin approved (same plan_id). Scouting admins only.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { canManageScoutingAdmin, clientFromRequest, fetchActorProfile } from '$lib/server/scouting/scoutingAccess.js';
import { getSupabase } from '$lib/server/serviceClient.js';
import { loadCleanupPlan } from '$lib/server/retention/measure.js';
import { applyCleanupPlan } from '$lib/server/retention/apply.js';

const NO_STORE = { 'cache-control': 'no-store' };

async function authorize(request, db) {
  const { actorId, profile, rosterKeys } = await fetchActorProfile(clientFromRequest(request), { rosterDb: db });
  if (!actorId) return { response: json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!canManageScoutingAdmin(profile, rosterKeys)) return { response: json({ error: 'Forbidden' }, { status: 403 }) };
  return { actorId };
}

export async function GET({ request }) {
  try {
    const db = getSupabase();
    const auth = await authorize(request, db);
    if (auth.response) return auth.response;
    return json({ success: true, data: await loadCleanupPlan(db, { env }) }, { headers: NO_STORE });
  } catch (err) {
    return json({ error: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    const db = getSupabase();
    const auth = await authorize(request, db);
    if (auth.response) return auth.response;
    const body = await request.json().catch(() => ({}));
    if (body?.action !== 'approve') return json({ error: 'Unknown action' }, { status: 400 });
    const plan = await loadCleanupPlan(db, { env });
    if (!plan.available) return json({ error: plan.reason }, { status: 409 });
    if (!plan.triggered || !plan.items.length)
      return json({ error: 'Nothing to clean: no storage limit is crossed.' }, { status: 409 });
    if (!body.plan_id || body.plan_id !== plan.planId)
      return json(
        { error: 'The cleanup plan changed since you opened it. Reload and review it again.', data: plan },
        { status: 409 }
      );
    const result = await applyCleanupPlan(db, plan, { actorId: auth.actorId });
    return json({ success: result.errors.length === 0, data: result }, { headers: NO_STORE });
  } catch (err) {
    return json({ error: String(err?.message || err) }, { status: 500 });
  }
}

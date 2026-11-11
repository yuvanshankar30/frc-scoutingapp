import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isAuthorizedCronRequest } from '$lib/server/integrations/cron_auth.js';
import { getSupabase } from '$lib/server/serviceClient.js';
import { loadCleanupPlan } from '$lib/server/retention/measure.js';
import { notifyDataCleanupPlan } from '$lib/server/integrations/slack_notifications.js';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

// Daily data cleanup check, cron-only with the same token as the other scheduled sweeps. It never deletes:
// when a storage limit is crossed and something is old enough to clean, it DMs the admins once per plan with a link
// to Scouting Admin -> Data, where an admin reviews and approves the cleanup.
async function handleCronCheck({ request }) {
  if (!isAuthorizedCronRequest({ headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
  }
  const plan = await loadCleanupPlan(getSupabase(), { env });
  if (!plan.available) return json({ ok: false, reason: plan.reason }, { headers: NO_STORE_HEADERS });
  const notified = plan.items.length ? await notifyDataCleanupPlan(plan) : null;
  return json(
    {
      ok: true,
      triggered: plan.triggered,
      reasons: plan.reasons,
      items: plan.items.length,
      plan_id: plan.planId,
      notified
    },
    { headers: NO_STORE_HEADERS }
  );
}

export const GET = handleCronCheck;
export const POST = handleCronCheck;

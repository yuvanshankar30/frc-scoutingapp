// Reads what the cleanup plan (#125) is built from: sizes and the per-event inventory (SQL functions from migration
// 20261024000000_data_cleanup_inventory.sql, service role only), the global sources' counts and the active event.
import { RETENTION_POLICY, retentionLimits } from './policy.js';
import { buildCleanupPlan } from './plan.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const MIGRATION_NOTE =
  'Storage sizes need the data cleanup migration (20261024000000_data_cleanup_inventory.sql) on the database.';

async function globalCounts(db, now) {
  const out = {};
  for (const entry of RETENTION_POLICY.filter((p) => p.scope === 'global')) {
    if (entry.source !== 'user_notification_logs') continue;
    const cutoff = new Date(now.getTime() - entry.keepDays * DAY_MS).toISOString();
    const { count, error } = await db
      .from('user_notification_logs')
      .select('id', { count: 'exact', head: true })
      .in('event_type', entry.eventTypes)
      .lt('sent_at', cutoff);
    if (error) throw new Error(`Counting ${entry.source} failed: ${error.message}`);
    out[entry.id] = count || 0;
  }
  return out;
}

/** The current plan, or { available: false, reason } when the inventory functions are not on the database yet. */
export async function loadCleanupPlan(db, { env: envLike = {}, now = new Date() } = {}) {
  const [sizesRes, inventoryRes, settingsRes] = await Promise.all([
    db.rpc('retention_sizes'),
    db.rpc('retention_event_inventory'),
    db.from('scouting_settings').select('event_key').limit(1).maybeSingle()
  ]);
  if (sizesRes.error || inventoryRes.error) {
    return { available: false, reason: MIGRATION_NOTE, detail: (sizesRes.error || inventoryRes.error).message };
  }
  const plan = buildCleanupPlan({
    sizes: sizesRes.data || [],
    inventory: inventoryRes.data || [],
    globalCounts: await globalCounts(db, now),
    limits: retentionLimits(envLike),
    activeEventKey: settingsRes.data?.event_key || '',
    now
  });
  return { available: true, ...plan };
}

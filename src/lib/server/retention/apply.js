// Runs an approved cleanup plan (#125) in batches and writes one summary row to activity_log. Only the items of the
// plan are touched; every query repeats the plan's scope (event and season rule).
import { escapeMatchKeyPrefix } from '$lib/scouting/eventCode.js';
import { RETENTION_POLICY } from './policy.js';

export const ROW_BATCH = 1000;
export const FILE_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

async function deleteByIds(db, table, ids, batchSize) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const { error } = await db.from(table).delete().in('id', batch);
    if (error) throw new Error(`Deleting from ${table} failed: ${error.message}`);
    deleted += batch.length;
  }
  return deleted;
}

async function selectIds(build) {
  const ids = [];
  for (let from = 0; ; from += ROW_BATCH) {
    const { data, error } = await build().range(from, from + ROW_BATCH - 1);
    if (error) throw new Error(error.message);
    ids.push(...(data || []).map((row) => row.id));
    if (!data || data.length < ROW_BATCH) return ids;
  }
}

async function cleanScoutDataEvents(db, eventKey) {
  const prefix = escapeMatchKeyPrefix(eventKey);
  if (!prefix) return 0;
  const ids = await selectIds(() => db.from('scout_data_events').select('id').ilike('match_key', prefix).order('id'));
  return deleteByIds(db, 'scout_data_events', ids, ROW_BATCH);
}

async function cleanBucket(db, bucket, eventKey) {
  const { data, error } = await db.rpc('retention_storage_objects', { p_bucket: bucket, p_event_key: eventKey });
  if (error) throw new Error(error.message);
  const names = (data || []).map((r) => r.name).filter((n) => n && !n.includes('..'));
  let removed = 0;
  for (let i = 0; i < names.length; i += FILE_BATCH) {
    const batch = names.slice(i, i + FILE_BATCH);
    const { error: removeError } = await db.storage.from(bucket).remove(batch);
    if (removeError) throw new Error(`Removing files from ${bucket} failed: ${removeError.message}`);
    removed += batch.length;
  }
  return removed;
}

async function cleanNotificationLogs(db, entry, now) {
  const cutoff = new Date(now.getTime() - entry.keepDays * DAY_MS).toISOString();
  const ids = await selectIds(() =>
    db.from('user_notification_logs').select('id').in('event_type', entry.eventTypes).lt('sent_at', cutoff).order('id')
  );
  return deleteByIds(db, 'user_notification_logs', ids, ROW_BATCH);
}

/** Delete every item of `plan`. Returns { deleted: [{ policyId, eventKey, count }], errors: [...] }. */
export async function applyCleanupPlan(db, plan, { actorId = null, now = new Date() } = {}) {
  const policy = new Map(RETENTION_POLICY.map((p) => [p.id, p]));
  const deleted = [];
  const errors = [];
  for (const item of plan?.items || []) {
    const entry = policy.get(item.policyId);
    if (!entry) continue;
    try {
      let count = 0;
      if (entry.id === 'scout_data_events') count = await cleanScoutDataEvents(db, item.eventKey);
      else if (entry.bucket) count = await cleanBucket(db, entry.bucket, item.eventKey);
      else if (entry.id === 'notification_logs') count = await cleanNotificationLogs(db, entry, now);
      deleted.push({ policyId: item.policyId, eventKey: item.eventKey || null, count });
    } catch (err) {
      errors.push({ policyId: item.policyId, eventKey: item.eventKey || null, error: String(err?.message || err) });
    }
  }
  const { error: logError } = await db.from('activity_log').insert({
    table_name: 'data_cleanup',
    operation: 'DELETE',
    row_id: plan?.planId || null,
    actor: actorId,
    new_data: { plan_id: plan?.planId || null, reasons: plan?.reasons || [], deleted, errors }
  });
  return { deleted, errors, logged: !logError };
}

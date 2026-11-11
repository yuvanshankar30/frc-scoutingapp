// What the on-demand data cleanup may delete, and when. Nothing is deleted on a schedule: the daily check only
// plans, and only when a storage limit is crossed; an admin approves every cleanup.
//
// The policy names rows and objects, not whole tables:
// - event-scoped sources: only events from a past season, never the active event, and only once their newest item
//   is older than keepDays;
// - global sources: only the competition app's own rows, older than keepDays.
// Never listed, so never cleaned: match and pit scouting reports, picklists, rankings, assignments, the activity_log
// audit trail and the branding bucket (the team logo).

export const RETENTION_POLICY = Object.freeze([
  Object.freeze({
    id: 'scout_data_events',
    label: 'Scouting event logs',
    source: 'scout_data_events',
    scope: 'event',
    keepDays: 180,
    unit: 'rows'
  }),
  Object.freeze({
    id: 'pit_photos',
    label: 'Pit scouting photos',
    source: 'storage:pit-scout-photos',
    bucket: 'pit-scout-photos',
    scope: 'event',
    keepDays: 180,
    unit: 'files'
  }),
  Object.freeze({
    id: 'notification_logs',
    label: 'Sent scouting notification records',
    source: 'user_notification_logs',
    scope: 'global',
    keepDays: 90,
    unit: 'rows',
    eventTypes: Object.freeze(['shift_assignments', 'match_reminders', 'data_cleanup'])
  })
]);

/** Tables and buckets the policy can clean, for labelling the size list ("cleanable" vs "kept"). */
export const CLEANABLE_TABLES = Object.freeze(['scout_data_events', 'user_notification_logs']);
export const CLEANABLE_BUCKETS = Object.freeze(['pit-scout-photos']);

const MB = 1024 * 1024;

/** Limits that trigger a cleanup plan: 80% of the Supabase free plan (500 MB database, 1 GB storage) by default. */
export function retentionLimits(envLike = {}) {
  const read = (name, fallbackMb) => {
    const value = Number(envLike?.[name]);
    return Math.round((Number.isFinite(value) && value > 0 ? value : fallbackMb) * MB);
  };
  return { dbBytes: read('RETENTION_DB_LIMIT_MB', 400), storageBytes: read('RETENTION_STORAGE_LIMIT_MB', 800) };
}

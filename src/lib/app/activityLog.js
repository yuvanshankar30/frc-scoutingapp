// Turns activity_log rows into readable entries for Scouting Admin > People > Activity: "Updated pit scouting for team
// 254", the person who did it, and only the fields that changed. Pure, so it can be tested.

/** Plain names for the tables the activity_log trigger watches. */
export const ACTIVITY_AREAS = Object.freeze({
  match_scout_entries: 'Match scouting',
  pit_scout_entries: 'Pit scouting',
  pit_problem_reports: 'Pit problems',
  scout_notes: 'Notes',
  scout_match_assignments: 'Match assignments',
  scout_pit_assignments: 'Pit assignments',
  scout_match_deadlines: 'Deadlines',
  scouting_events: 'Events',
  scouting_settings: 'Event settings',
  scouting_form_versions: 'Scouting forms',
  scouting_match_rankings: 'Match rankings',
  scouting_picklist: 'Picklist',
  user_profiles: 'People',
  roster_entries: 'Competition roles',
  roster_keys: 'Competition roles',
  rosters: 'Competition roles',
  access_roles: 'Roles',
  app_settings: 'Team settings',
  data_cleanup: 'Data cleanup'
});

const VERBS = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };

// Columns that change on every save and say nothing to a reader.
const NOISE = new Set(['updated_at', 'created_at', 'updated_by', 'created_by', 'id']);
// Never shown, whatever table they come from.
const PRIVATE = new Set(['email', 'slack_user_id', 'slack_dm_channel', 'notification_settings', 'password']);

const team = (key) => String(key || '').replace(/^frc/i, '');

/** A short name for the record a row is about: a team, a match, a person, a role. */
export function subjectOf(row) {
  const data = row?.new_data || row?.old_data || {};
  if (data.full_name) return data.full_name;
  if (data.name) return data.name;
  if (data.key_name) return data.key_name;
  const parts = [];
  if (data.team_key) parts.push(`team ${team(data.team_key)}`);
  if (data.match_key) parts.push(String(data.match_key).split('_').at(-1).toUpperCase());
  if (!parts.length && data.event_key) parts.push(String(data.event_key).toUpperCase());
  return parts.join(', ');
}

const short = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};

/** One readable entry from an activity_log row; `names` maps actor ids to names. */
export function describeActivity(row, names = new Map()) {
  const area = ACTIVITY_AREAS[row.table_name] || String(row.table_name || '').replace(/_/g, ' ');
  const changes = (row.changed_columns || [])
    .filter((column) => !NOISE.has(column) && !PRIVATE.has(column))
    .slice(0, 8)
    .map((column) => ({
      field: column.replace(/_/g, ' '),
      from: short(row.old_data?.[column]),
      to: short(row.new_data?.[column])
    }));
  return {
    id: row.id,
    at: row.created_at,
    area,
    table: row.table_name,
    operation: row.operation,
    verb: VERBS[row.operation] || row.operation,
    subject: subjectOf(row),
    actor: row.actor ? names.get(row.actor) || 'Someone (account removed)' : 'The system',
    changes
  };
}

/** Entries matching a search over who, what and the changed fields. */
export function filterActivity(entries, query) {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) =>
    [entry.actor, entry.area, entry.verb, entry.subject, ...entry.changes.flatMap((c) => [c.field, c.to, c.from])]
      .join(' ')
      .toLowerCase()
      .includes(needle)
  );
}

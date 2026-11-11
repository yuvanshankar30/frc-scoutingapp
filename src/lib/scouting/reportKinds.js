// Match Scouting is split into three separate scouting jobs, each its own tab and its own saved report:
//   data:        what the robot did (pre-match, auto, teleop roles and balls scored, shuttling)
//   performance: how well it played (shot accuracy, BPS and other ratings, intake speed, driver, power ranking)
//   robot:       its condition (status, crashes, collisions, jams), cards, fouls, breaks and the pit crew handoff
// One scout can file one report of each kind for the same robot in a match. Reports saved before the split have
// no kind and count as data reports.

export const REPORT_KINDS = Object.freeze(['data', 'performance', 'robot']);

/**
 * Columns only one kind of report may fill. The database enforces the same lists
 * (match_scout_entries_*_only_fields, migration 20261022000400); the API clears the others before saving, so a
 * page left open on an old layout can't send a stray answer that the database would reject.
 */
export const KIND_ONLY_FIELDS = Object.freeze({
  data: Object.freeze([
    'starting_position',
    'auto_start_zone',
    'auto_points_band',
    'auto_points_min',
    'auto_points_max',
    'auto_points_average',
    'auto_finish',
    'auto_moved',
    'auto_path_name',
    'auto_cycles',
    'preload',
    'teleop_notes',
    'balls_scored_band',
    'balls_scored_min',
    'balls_scored_max',
    'balls_scored_average',
    'shuttled',
    'shuttle_band',
    'shuttle_min',
    'shuttle_max',
    'shuttle_average',
    'shuttle_rating',
    'shuttle_notes',
    'defense'
  ]),
  performance: Object.freeze(['offense_rating', 'defense_rating', 'performance_notes', 'bps']),
  robot: Object.freeze([
    'fouls_minor',
    'fouls_major',
    'break_details',
    'break_impact',
    'break_response',
    'robot_status_shifts',
    'foul_nature',
    'foul_details'
  ])
});

/** The report with every field that belongs to another kind cleared. */
export function withoutOtherKindFields(report) {
  const kind = REPORT_KINDS.includes(report?.report_kind) ? report.report_kind : 'data';
  const cleared = { ...report };
  for (const [other, fields] of Object.entries(KIND_ONLY_FIELDS)) {
    if (other === kind) continue;
    for (const field of fields) if (field in cleared) cleared[field] = null;
  }
  return cleared;
}

export const REPORT_KIND_LABELS = Object.freeze({
  data: 'Data scouting',
  performance: 'Performance scouting',
  robot: 'Robot scouting'
});

/** The stages each tab walks through, in order. Every tab starts with the assignment and ends with post-match. */
export const REPORT_KIND_PHASES = Object.freeze({
  data: Object.freeze(['prematch', 'auto', 'teleop', 'shuttling', 'postmatch']),
  performance: Object.freeze(['prematch', 'performance', 'postmatch']),
  robot: Object.freeze(['prematch', 'robot', 'postmatch'])
});

/** Scouting Admin competition roles that pick a scout's tab. */
export const REPORT_KIND_ROLES = Object.freeze({
  'Data Scout Member': 'data',
  'Performance Scout Member': 'performance',
  'Robot Scout Member': 'robot'
});

export const reportKindOf = (row) => (REPORT_KINDS.includes(row?.report_kind) ? row.report_kind : 'data');

/** Reports that carry auto/teleop/shuttling data, which every match statistic is built from. */
export const isDataReport = (row) => reportKindOf(row) === 'data';

/** The tab a scout starts on, from their roster keys (case-insensitive); data when they have none of the three. */
export function defaultReportKind(rosterKeys) {
  const keys = new Set(
    (rosterKeys || []).map((key) =>
      String(key || '')
        .trim()
        .toLowerCase()
    )
  );
  for (const [role, kind] of Object.entries(REPORT_KIND_ROLES)) {
    if (keys.has(role.toLowerCase())) return kind;
  }
  return 'data';
}

/** The member roster keys (lowercase) that make someone a match scout, whichever tab they scout. */
export const MATCH_SCOUT_MEMBER_KEYS = Object.freeze(Object.keys(REPORT_KIND_ROLES).map((role) => role.toLowerCase()));

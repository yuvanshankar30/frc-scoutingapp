// The scouting export people analyze: one table, one row per record, plain column names and plain values. No ids,
// account codes, form versions, Slack bookkeeping, raw min/max duplicates or auto paths; matches read "Qual 12",
// teams "1234", yes/no instead of true/false, codes as words, lists and rankings as text, and numbers kept as numbers
// so they can be sorted and averaged. The same table becomes the Excel file (colors by section and record type) and
// the CSV.

import { compareMatchKeys, matchLabel } from '$lib/matches/matchKeys.js';
import { ACCURACY_LABELS, BPS_LABELS, MATCH_SHIFTS } from '$lib/scouting/matchScouting.js';
import { defenseSummary } from '$lib/scouting/defenseStats.js';
import { formatLocal } from '$lib/app/timezone.js';
import { csvCell } from './scoutingCsvExport.js';
import { buildXlsx } from '../xlsx.js';

const team = (key) => String(key || '').replace(/^frc/i, '');
const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';
const number = (value) => {
  if (!present(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : null);
const text = (value) => (present(value) ? String(value).trim() : null);
// "right trench" -> "Right trench", "did-not-run" -> "Did not run".
const words = (value) => {
  if (!present(value)) return null;
  const spaced = String(value).trim().replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
const list = (value) =>
  Array.isArray(value) && value.length ? [...new Set(value.map(words).filter(Boolean))].join(', ') : null;
const rating = (value) => {
  const parsed = number(value);
  return parsed && parsed > 0 ? parsed : null;
};
const band = (labels, value) => {
  const parsed = rating(value);
  return parsed ? labels[Math.min(labels.length, Math.max(1, Math.round(parsed))) - 1] : null;
};
const ranking = (order) => (order.length ? order.map((key, index) => `${index + 1}. ${team(key)}`).join('   ') : null);
const LOCAL_TIME = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
const when = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? formatLocal(date, LOCAL_TIME) : null;
};
// Free-form JSON from older forms (pit technical details, auto options): "Key: value; key: value".
const described = (value) => {
  if (!present(value)) return null;
  if (Array.isArray(value))
    return list(value.map((item) => (typeof item === 'object' ? item?.name || item?.label : item)));
  if (typeof value === 'object')
    return (
      Object.entries(value)
        // Lists of plain answers (preferred roles, motor types) are kept; nested objects are not.
        .map(([key, item]) => [
          key,
          Array.isArray(item) && item.every((entry) => typeof entry !== 'object') ? list(item) : item
        ])
        .filter(([, item]) => present(item) && typeof item !== 'object')
        .map(([key, item]) => `${words(key)}: ${item === true ? 'Yes' : item === false ? 'No' : item}`)
        .join('; ') || null
    );
  return text(value);
};

const STATUS = { active: 'Active', dead: 'Dead', stopped: 'Stopped', brownout: 'Brownout', unknown: 'Unknown' };
const AUTO_RAN = { ran: 'Ran', 'did-not-run': "Didn't run", true: 'Ran', false: "Didn't run" };
const CARD = { '': 'None', none: 'None', yellow: 'Yellow', red: 'Red' };
const DEFENSE_PERIOD_NAMES = { active: 'Hub active', inactive: 'Hub inactive' };
const SHIFT_NAMES = Object.fromEntries(MATCH_SHIFTS.map((shift) => [shift.key, shift.label]));
// "Shift 1: Active; Shift 2: Dead; ..." in shift order.
const shiftStatuses = (value) =>
  value && typeof value === 'object'
    ? MATCH_SHIFTS.filter((shift) => value[shift.key])
        .map((shift) => `${shift.label}: ${STATUS[value[shift.key]] ?? words(value[shift.key])}`)
        .join('; ') || null
    : null;
const KIND_NAMES = { data: 'Data scouting', performance: 'Performance scouting', robot: 'Robot scouting' };

// Column groups: the heading over each block of columns and its color in the Excel file.
export const EXPORT_GROUPS = Object.freeze([
  { key: 'overview', label: 'Who, when', fill: 'D9D9D9' },
  { key: 'data', label: 'Data scouting', fill: 'FCE4B6' },
  { key: 'performance', label: 'Performance scouting', fill: 'CFE2F3' },
  { key: 'robot', label: 'Robot scouting', fill: 'F4CCCC' },
  { key: 'pit', label: 'Pit scouting', fill: 'D9EAD3' },
  { key: 'notes', label: 'Notes, rankings and pit problems', fill: 'E4D7F5' }
]);

// Every column: header, group, width, how it reads a record, and (flag) when a value deserves red text.
const COLUMNS = [
  { group: 'overview', header: 'Record', width: 22, get: (r) => r.label },
  { group: 'overview', header: 'Match', width: 18, get: (r) => (r.match_key ? matchLabel(r.match_key) : null) },
  { group: 'overview', header: 'Team', width: 8, get: (r) => number(team(r.team_key)) ?? text(team(r.team_key)) },
  { group: 'overview', header: 'Alliance', width: 9, get: (r) => words(r.alliance) },
  { group: 'overview', header: 'Scout', width: 18, get: (r) => text(r.scout_name) },
  { group: 'overview', header: 'Submitted (local time)', width: 18, get: (r) => when(r.created_at) },
  {
    group: 'overview',
    header: 'Robot showed up',
    width: 10,
    get: (r) => (r.kind ? (r.robot_present === false ? 'No' : 'Yes') : null),
    flag: (value) => value === 'No'
  },

  { group: 'data', header: 'Starting position', width: 15, get: (r) => words(r.starting_position) },
  { group: 'data', header: 'Preload', width: 9, get: (r) => yesNo(r.preload) },
  { group: 'data', header: 'Auto', width: 11, get: (r) => AUTO_RAN[String(r.auto_moved)] ?? words(r.auto_moved) },
  { group: 'data', header: 'Auto points (as entered)', width: 12, get: (r) => text(r.auto_points_band) },
  { group: 'data', header: 'Auto points (estimate)', width: 12, get: (r) => number(r.auto_points_average) },
  { group: 'data', header: 'Auto cycles', width: 9, get: (r) => number(r.auto_cycles) },
  { group: 'data', header: 'Fuel picked up from', width: 22, get: (r) => list(r.ball_sources) },
  { group: 'data', header: 'Balls scored (as entered)', width: 12, get: (r) => text(r.balls_scored_band) },
  { group: 'data', header: 'Balls scored (estimate)', width: 12, get: (r) => number(r.balls_scored_average) },
  {
    group: 'data',
    header: 'Teleop roles',
    width: 18,
    get: (r) => list(r.teleop_roles) ?? (r.teleop_roles_none ? 'None seen' : null)
  },
  {
    group: 'data',
    header: 'Defended against',
    width: 16,
    get: (r) => (r.defense?.targets?.length ? r.defense.targets.map(team).join(', ') : null)
  },
  {
    group: 'data',
    header: 'Defended while',
    width: 16,
    get: (r) =>
      r.defense?.periods?.length ? r.defense.periods.map((p) => DEFENSE_PERIOD_NAMES[p] ?? words(p)).join(', ') : null
  },
  {
    group: 'data',
    header: 'Defense shifts',
    width: 18,
    get: (r) =>
      r.defense?.shifts?.length ? r.defense.shifts.map((key) => SHIFT_NAMES[key] ?? words(key)).join(', ') : null
  },
  { group: 'data', header: 'Defense effectiveness (1-10)', width: 12, get: (r) => rating(r.defense?.effectiveness) },
  { group: 'data', header: 'Shuttled', width: 9, get: (r) => yesNo(r.shuttled) },
  { group: 'data', header: 'Balls shuttled (as entered)', width: 12, get: (r) => text(r.shuttle_band) },
  { group: 'data', header: 'Balls shuttled (estimate)', width: 12, get: (r) => number(r.shuttle_average) },
  { group: 'data', header: 'Shuttling rating (1-5)', width: 11, get: (r) => rating(r.shuttle_rating) },
  { group: 'data', header: 'Teleop notes', width: 40, wrap: true, get: (r) => text(r.teleop_notes) },
  { group: 'data', header: 'Shuttling notes', width: 30, wrap: true, get: (r) => text(r.shuttle_notes) },

  { group: 'performance', header: 'Shot accuracy (1-5)', width: 11, get: (r) => rating(r.ratings?.['Shot accuracy']) },
  {
    group: 'performance',
    header: 'Shot accuracy means',
    width: 13,
    get: (r) => band(ACCURACY_LABELS, r.ratings?.['Shot accuracy'])
  },
  { group: 'performance', header: 'Balls per second (slider)', width: 10, get: (r) => number(r.bps) },
  { group: 'performance', header: 'BPS (1-5)', width: 9, get: (r) => rating(r.ratings?.BPS) },
  { group: 'performance', header: 'BPS means', width: 12, get: (r) => band(BPS_LABELS, r.ratings?.BPS) },
  {
    group: 'performance',
    header: 'Driver awareness (1-5)',
    width: 11,
    get: (r) => rating(r.ratings?.['Driver awareness'])
  },
  { group: 'performance', header: 'Reliability rating (1-5)', width: 11, get: (r) => rating(r.ratings?.Reliability) },
  { group: 'performance', header: 'Offense (1-5)', width: 9, get: (r) => rating(r.offense_rating) },
  {
    group: 'performance',
    header: 'Defense (1-5)',
    width: 9,
    get: (r) => rating(r.defense_rating ?? r.ratings?.Defense)
  },
  { group: 'performance', header: 'Driver skill (1-5)', width: 9, get: (r) => rating(r.driver_skill) },
  { group: 'performance', header: 'Intake speed (1-5)', width: 9, get: (r) => rating(r.intake_speed) },
  {
    group: 'performance',
    header: 'Power ranking (best first)',
    width: 34,
    get: (r) =>
      r.power_ranking && typeof r.power_ranking === 'object'
        ? ranking(
            Object.entries(r.power_ranking)
              .filter(([, place]) => number(place) !== null)
              .sort((a, b) => Number(a[1]) - Number(b[1]))
              .map(([key]) => key)
          )
        : null
  },
  { group: 'performance', header: 'Performance notes', width: 40, wrap: true, get: (r) => text(r.performance_notes) },

  {
    group: 'robot',
    header: 'Robot status',
    width: 11,
    get: (r) => STATUS[r.teleop_robot_status] ?? words(r.teleop_robot_status),
    flag: (value) => ['Dead', 'Stopped', 'Brownout'].includes(value)
  },
  {
    group: 'robot',
    header: 'Robot status by shift',
    width: 30,
    wrap: true,
    get: (r) => shiftStatuses(r.robot_status_shifts),
    flag: (value) => /Dead|Stopped/.test(value || '')
  },
  { group: 'robot', header: 'Big crash', width: 9, get: (r) => yesNo(r.significant_crash), flag: (v) => v === 'Yes' },
  { group: 'robot', header: 'Crashed into', width: 13, get: (r) => words(r.crash_target) },
  { group: 'robot', header: 'Crash details', width: 30, wrap: true, get: (r) => text(r.crash_details) },
  { group: 'robot', header: 'Auto collision', width: 9, get: (r) => yesNo(r.auto_collision), flag: (v) => v === 'Yes' },
  { group: 'robot', header: 'Collision notes', width: 30, wrap: true, get: (r) => text(r.auto_collision_notes) },
  { group: 'robot', header: 'Intake jammed', width: 9, get: (r) => yesNo(r.intake_jammed), flag: (v) => v === 'Yes' },
  {
    group: 'robot',
    header: 'Mechanical break',
    width: 10,
    get: (r) => yesNo(r.mechanical_break),
    flag: (v) => v === 'Yes'
  },
  { group: 'robot', header: 'Beached', width: 9, get: (r) => yesNo(r.beached), flag: (v) => v === 'Yes' },
  {
    group: 'robot',
    header: 'Card',
    width: 8,
    get: (r) => (r.kind === 'robot' || present(r.card) ? (CARD[String(r.card ?? '')] ?? words(r.card)) : null),
    flag: (v) => v === 'Yellow' || v === 'Red'
  },
  { group: 'robot', header: 'Minor fouls', width: 8, get: (r) => number(r.fouls_minor) },
  { group: 'robot', header: 'Major fouls', width: 8, get: (r) => number(r.fouls_major) },
  { group: 'robot', header: 'Foul nature', width: 18, get: (r) => text(r.foul_nature) },
  { group: 'robot', header: 'Foul details', width: 30, wrap: true, get: (r) => text(r.foul_details) },
  { group: 'robot', header: 'What broke', width: 30, wrap: true, get: (r) => text(r.break_details) },
  { group: 'robot', header: 'Effect on the match', width: 30, wrap: true, get: (r) => text(r.break_impact) },
  { group: 'robot', header: 'What the team did', width: 30, wrap: true, get: (r) => text(r.break_response) },

  { group: 'pit', header: 'Robot type', width: 16, get: (r) => text(r.robot_archetype) },
  { group: 'pit', header: 'Drivetrain', width: 12, get: (r) => text(r.drivebase_type) },
  { group: 'pit', header: 'Shooter', width: 12, get: (r) => text(r.shooter_type) },
  { group: 'pit', header: 'Hopper', width: 12, get: (r) => text(r.hopper_type) },
  { group: 'pit', header: 'Estimated BPS (pit)', width: 10, get: (r) => number(r.estimated_bps) },
  { group: 'pit', header: 'Auto points (pit)', width: 10, get: (r) => text(r.auto_points_estimate) },
  { group: 'pit', header: 'Autos they can run', width: 22, get: (r) => described(r.auto_options) },
  { group: 'pit', header: 'Climb', width: 14, get: (r) => list(r.climb_options) },
  { group: 'pit', header: 'Human player balls in auto', width: 12, get: (r) => text(r.human_player_balls_in_auto) },
  { group: 'pit', header: 'Most likely to break', width: 18, get: (r) => text(r.likely_breaking_component) },
  { group: 'pit', header: 'Technical details', width: 30, wrap: true, get: (r) => described(r.technical_details) },

  {
    group: 'notes',
    header: 'Notes',
    width: 40,
    wrap: true,
    get: (r) => text(r.post_notes) ?? text(r.notes) ?? text(r.additional_notes)
  },
  {
    group: 'notes',
    header: 'Match ranking (best first)',
    width: 34,
    get: (r) => (r.ranked_team_keys ? ranking(r.ranked_team_keys) : null)
  },
  { group: 'notes', header: 'Pit problem', width: 30, wrap: true, get: (r) => text(r.summary) },
  { group: 'notes', header: 'Pit problem details', width: 30, wrap: true, get: (r) => text(r.detail) },
  { group: 'notes', header: 'Severity', width: 9, get: (r) => words(r.severity), flag: (v) => v === 'Urgent' },
  { group: 'notes', header: 'Resolved', width: 9, get: (r) => yesNo(r.resolved) }
];

// Row tint per record type, so each kind stands out when the sheet is sorted or filtered.
const ROW_TINTS = {
  data: 'FFF8E8',
  performance: 'EEF5FC',
  robot: 'FCEEEE',
  pit: 'EEF7EA',
  ranking: 'F2F2F2',
  note: 'F6F0FC',
  issue: 'FDEDE0'
};
const TYPE_ORDER = ['data', 'performance', 'robot', 'pit', 'ranking', 'note', 'issue'];

/**
 * The export table from an event's raw records.
 * @param {{ matchEntries?: Array, pitEntries?: Array, rankings?: Array, notes?: Array, problems?: Array }} records
 */
export function buildExportTable({
  matchEntries = [],
  pitEntries = [],
  rankings = [],
  notes = [],
  problems = []
} = {}) {
  const records = [
    ...matchEntries.map((row) => {
      const kind = ['performance', 'robot'].includes(row.report_kind) ? row.report_kind : 'data';
      return { ...row, type: kind, kind, label: KIND_NAMES[kind] };
    }),
    ...pitEntries.map((row) => ({ ...row, type: 'pit', label: 'Pit scouting' })),
    ...rankings.map((row) => ({ ...row, type: 'ranking', label: 'Match ranking' })),
    ...notes.map((row) => ({ ...row, type: 'note', label: 'Scout note' })),
    ...problems.map((row) => ({ ...row, type: 'issue', label: 'Pit problem' }))
  ].sort(
    (a, b) =>
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      (a.match_key && b.match_key
        ? compareMatchKeys(a.match_key, b.match_key)
        : a.match_key
          ? -1
          : b.match_key
            ? 1
            : 0) ||
      (Number(team(a.team_key)) || 0) - (Number(team(b.team_key)) || 0)
  );
  // Columns nobody filled in for this event are dropped, so the sheet only shows what was scouted.
  // Robot-condition columns come only from reports that asked them: Robot reports, and older combined forms. Current
  // Data and Performance reports store those columns at their defaults (no crash, no jam), which are not answers.
  const askedRobot = (record) => record.kind === 'robot' || (record.kind && record.form_version !== 2);
  const values = records.map((record) =>
    COLUMNS.map((column) =>
      column.group === 'robot' && record.kind && !askedRobot(record) ? null : column.get(record)
    )
  );
  const used = COLUMNS.map((_, index) => index < 6 || values.some((row) => present(row[index])));
  const columns = COLUMNS.filter((_, index) => used[index]);
  return {
    columns,
    rows: records.map((record, recordIndex) => ({
      type: record.type,
      cells: values[recordIndex].filter((_, index) => used[index])
    })),
    teams: teamSummary(records)
  };
}

const average = (values) => {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
};
const PROBLEM_STATUSES = new Set(['dead', 'stopped', 'brownout']);

// One row per team: how many reports of each kind, the averages a strategist compares teams by, how often something
// went wrong, and the pit basics. Averages skip blanks (not scouted), never count them as 0.
function teamSummary(records) {
  const byTeam = new Map();
  const teamRow = (key) => {
    if (!byTeam.has(key)) byTeam.set(key, { key, data: [], performance: [], robot: [], pit: null, places: [] });
    return byTeam.get(key);
  };
  for (const record of records) {
    if (record.type === 'ranking') continue;
    if (!record.team_key) continue;
    const row = teamRow(record.team_key);
    if (record.type === 'pit') row.pit = record;
    else if (['data', 'performance', 'robot'].includes(record.type)) row[record.type].push(record);
  }
  // Performance scouts rank every robot they watched, so a team's places come from all Performance reports.
  for (const record of records) {
    if (record.type !== 'performance' || !record.power_ranking || typeof record.power_ranking !== 'object') continue;
    for (const [key, place] of Object.entries(record.power_ranking))
      if (number(place) !== null) teamRow(key).places.push(Number(place));
  }
  const defense = new Map(
    defenseSummary(records.filter((record) => record.type === 'data')).map((row) => [row.team_key, row])
  );
  return [...byTeam.values()]
    .map((row) => {
      const defenseRow = defense.get(row.key);
      const shown = [...row.data, ...row.performance, ...row.robot].filter((record) => record.robot_present !== false);
      const watched = row.robot.filter((record) => record.robot_present !== false);
      const problemMatches = new Set(
        watched
          .filter(
            (record) =>
              PROBLEM_STATUSES.has(record.teleop_robot_status) ||
              record.mechanical_break === true ||
              record.significant_crash === true ||
              record.beached === true ||
              record.intake_jammed === true
          )
          .map((record) => record.match_key)
      );
      const noShows = new Set(
        [...row.data, ...row.performance, ...row.robot]
          .filter((record) => record.robot_present === false)
          .map((record) => record.match_key)
      );
      const ratings = (field) => average(row.performance.map((record) => rating(record.ratings?.[field])));
      return {
        team: number(team(row.key)) ?? team(row.key),
        matches: new Set(shown.map((record) => record.match_key)).size,
        dataReports: row.data.length,
        performanceReports: row.performance.length,
        robotReports: row.robot.length,
        balls: average(row.data.map((record) => number(record.balls_scored_average))),
        auto: average(row.data.map((record) => number(record.auto_points_average))),
        accuracy: ratings('Shot accuracy'),
        bps: ratings('BPS'),
        bpsExact: average(row.performance.map((record) => number(record.bps))),
        defensePlayed: defenseRow?.playedRating ?? null,
        defenseImpact: defenseRow?.impact ?? null,
        defenseResistance: defenseRow?.resistance ?? null,
        keptWhenDefended: defenseRow?.keptShare ?? null,
        driver: average(row.performance.map((record) => rating(record.driver_skill))),
        defense: average(row.performance.map((record) => rating(record.defense_rating ?? record.ratings?.Defense))),
        powerPlace: average(row.places),
        problems: problemMatches.size,
        watched: new Set(watched.map((record) => record.match_key)).size,
        noShows: noShows.size,
        robotType: text(row.pit?.robot_archetype),
        drivetrain: text(row.pit?.drivebase_type)
      };
    })
    .filter((row) => row.dataReports || row.performanceReports || row.robotReports || row.robotType || row.drivetrain)
    .sort((a, b) => (b.balls ?? -1) - (a.balls ?? -1) || (Number(a.team) || 0) - (Number(b.team) || 0));
}

/** The table as CSV: plain headers and values, opened cleanly by Excel (UTF-8 marker) and Sheets. */
export function exportTableToCsv(table) {
  return `\uFEFF${[
    table.columns.map((column) => csvCell(column.header)).join(','),
    ...table.rows.map((row) => row.cells.map((cell) => csvCell(cell)).join(','))
  ].join('\r\n')}\r\n`;
}

// Column width (in characters) that keeps a bold, wrapped heading from breaking inside a word: the longest word plus
// room for the filter button, and wide enough that the whole heading fits in three lines.
const FILTER_BUTTON = 5;
const BOLD = 1.3;
export function headerWidth(column) {
  const longestWord = Math.max(...column.header.split(/\s+/).map((word) => word.length));
  const threeLines = (column.header.length * BOLD) / 3;
  return Math.ceil(Math.max(column.width || 0, longestWord * BOLD + FILTER_BUTTON, threeLines + FILTER_BUTTON));
}

// The Excel file's tabs: the team summary, one tab per kind of scouting (with only that form's columns), everything
// together, and the guide.
const RECORD_TABS = [
  { name: 'Data scouting', types: ['data'], groups: ['data', 'notes'], tab: 'E6B54A' },
  { name: 'Performance scouting', types: ['performance'], groups: ['performance', 'notes'], tab: '5B9BD5' },
  { name: 'Robot scouting', types: ['robot'], groups: ['robot', 'notes'], tab: 'E06666' },
  { name: 'Pit scouting', types: ['pit'], groups: ['pit', 'notes'], tab: '6AA84F' },
  { name: 'Notes & pit problems', types: ['ranking', 'note', 'issue'], groups: ['notes'], tab: '8E7CC3' }
];
// 1-5 ratings: red (1) to green (5), so strong and weak robots stand out down a column.
const RATING_FILLS = ['F4CCCC', 'FCE5CD', 'FFF2CC', 'D9EAD3', 'B6D7A8'];
const isRatingColumn = (column) => /\(1-5\)$/.test(column.header);
const isDecimalColumn = (column) => /\(estimate\)$/.test(column.header);

function workbookStyles() {
  const styles = {};
  for (const group of EXPORT_GROUPS) {
    styles[`group-${group.key}`] = { fill: group.fill, bold: true, size: 12, align: 'left' };
    styles[`head-${group.key}`] = { fill: group.fill, bold: true, wrap: true, border: 'header', align: 'center' };
  }
  for (const [type, fill] of Object.entries({ ...ROW_TINTS, team: 'FFFFFF' })) {
    styles[`row-${type}`] = { fill, border: 'row' };
    styles[`wrap-${type}`] = { fill, wrap: true, border: 'row' };
    styles[`flag-${type}`] = { fill, bold: true, color: 'C00000', border: 'row' };
    styles[`dec-${type}`] = { fill, numFmt: '0.0', border: 'row' };
    styles[`id-${type}`] = { fill, bold: true, border: 'row' };
  }
  RATING_FILLS.forEach((fill, index) => {
    styles[`rate-${index + 1}`] = { fill, align: 'center', border: 'row' };
    styles[`rate-dec-${index + 1}`] = { fill, align: 'center', numFmt: '0.0', border: 'row' };
  });
  styles['team-top'] = { fill: 'B6D7A8', bold: true, border: 'row' };
  styles['team-bottom'] = { fill: 'F4CCCC', bold: true, border: 'row' };
  styles['team-mid'] = { bold: true, border: 'row' };
  styles['head-team'] = { fill: 'D9D9D9', bold: true, wrap: true, border: 'header', align: 'center' };
  styles.title = { bold: true, size: 14 };
  styles.subtitle = { color: '595959' };
  styles.label = { bold: true, wrap: true };
  styles.plain = { wrap: true };
  return styles;
}

function ratingStyle(value, decimal) {
  if (!Number.isFinite(value)) return null;
  const level = Math.min(5, Math.max(1, Math.round(value)));
  return `${decimal ? 'rate-dec' : 'rate'}-${level}`;
}

// One tab of records: the "Who, when" columns plus the given column groups, only the rows of the given types, and
// only columns somebody filled in on this tab.
function recordSheet(table, { name, types, groups, tab }) {
  const rows = table.rows.filter((row) => types.includes(row.type));
  const indexes = table.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column, index }) =>
      column.group === 'overview'
        ? index < 6 || rows.some((row) => present(row.cells[index]))
        : groups.includes(column.group) && rows.some((row) => present(row.cells[index]))
    );
  const columns = indexes.map(({ column }) => column);
  const sheetGroups = [];
  for (const column of columns) {
    const last = sheetGroups[sheetGroups.length - 1];
    if (last?.key === column.group) last.span += 1;
    else
      sheetGroups.push({
        key: column.group,
        label: EXPORT_GROUPS.find((group) => group.key === column.group).label,
        span: 1,
        style: `group-${column.group}`
      });
  }
  return {
    name,
    tabColor: tab,
    groups: sheetGroups,
    columns: columns.map((column) => ({
      header: column.header,
      width: headerWidth(column),
      headerStyle: `head-${column.group}`
    })),
    rows: rows.map((row) => {
      const cells = indexes.map(({ index }) => row.cells[index]);
      const cellStyles = {};
      columns.forEach((column, index) => {
        const value = cells[index];
        if (column.flag?.(value)) cellStyles[index] = `flag-${row.type}`;
        else if (isRatingColumn(column) && Number.isFinite(value)) cellStyles[index] = ratingStyle(value, false);
        else if (isDecimalColumn(column) && Number.isFinite(value)) cellStyles[index] = `dec-${row.type}`;
        else if (column.wrap) cellStyles[index] = `wrap-${row.type}`;
        else if (index < 3) cellStyles[index] = `id-${row.type}`;
      });
      return { cells, style: `row-${row.type}`, cellStyles };
    }),
    freeze: { rows: 2, columns: 3 },
    filter: true
  };
}

const TEAM_COLUMNS = [
  { header: 'Team', width: 8, get: (t) => t.team, kind: 'id' },
  { header: 'Robot type (pit)', width: 18, get: (t) => t.robotType },
  { header: 'Drivetrain (pit)', width: 13, get: (t) => t.drivetrain },
  { header: 'Matches scouted', width: 10, get: (t) => t.matches },
  { header: 'Data reports', width: 9, get: (t) => t.dataReports },
  { header: 'Performance reports', width: 12, get: (t) => t.performanceReports },
  { header: 'Robot reports', width: 9, get: (t) => t.robotReports },
  { header: 'Avg balls scored', width: 11, get: (t) => t.balls, kind: 'rank' },
  { header: 'Avg auto points', width: 10, get: (t) => t.auto, kind: 'decimal' },
  { header: 'Avg shot accuracy (1-5)', width: 12, get: (t) => t.accuracy, kind: 'rating' },
  { header: 'Avg BPS (1-5)', width: 10, get: (t) => t.bps, kind: 'rating' },
  { header: 'Avg balls per second (slider)', width: 11, get: (t) => t.bpsExact, kind: 'decimal' },
  { header: 'Avg driver skill (1-5)', width: 11, get: (t) => t.driver, kind: 'rating' },
  { header: 'Avg defense (1-5)', width: 10, get: (t) => t.defense, kind: 'rating' },
  { header: 'Defense played: avg effectiveness (1-10)', width: 13, get: (t) => t.defensePlayed, kind: 'decimal' },
  { header: 'Defense impact: % less its targets scored', width: 13, get: (t) => t.defenseImpact, kind: 'decimal' },
  { header: 'Defense resistance (0-10)', width: 12, get: (t) => t.defenseResistance, kind: 'decimal' },
  { header: '% of usual scoring kept when defended', width: 13, get: (t) => t.keptWhenDefended, kind: 'decimal' },
  { header: 'Avg power rank place (1 = best)', width: 13, get: (t) => t.powerPlace, kind: 'decimal' },
  { header: 'Matches with a problem', width: 11, get: (t) => (t.watched ? t.problems : null), kind: 'problem' },
  { header: 'Matches Robot scouts watched', width: 12, get: (t) => t.watched || null },
  { header: 'No-shows', width: 9, get: (t) => t.noShows, kind: 'problem' }
];

function teamSheet(table) {
  const teams = table.teams || [];
  const columns = TEAM_COLUMNS.filter(
    (column) => column.kind === 'id' || teams.some((row) => present(column.get(row)) && column.get(row) !== 0)
  );
  // Top and bottom quarter by average balls scored stand out green and red.
  const ranked = teams.filter((row) => Number.isFinite(row.balls));
  const quarter = Math.max(1, Math.floor(ranked.length / 4));
  const top = new Set(ranked.slice(0, quarter).map((row) => row.team));
  const bottom = new Set(ranked.slice(-quarter).map((row) => row.team));
  return {
    name: 'Teams',
    tabColor: '595959',
    columns: columns.map((column) => ({
      header: column.header,
      width: headerWidth({ header: column.header, width: column.width }),
      headerStyle: 'head-team'
    })),
    rows: teams.map((row) => {
      const cells = columns.map((column) => column.get(row));
      const cellStyles = {};
      columns.forEach((column, index) => {
        const value = cells[index];
        if (column.kind === 'id')
          cellStyles[index] = top.has(row.team) ? 'team-top' : bottom.has(row.team) ? 'team-bottom' : 'team-mid';
        else if (column.kind === 'rating') cellStyles[index] = ratingStyle(value, true) || 'row-team';
        else if (column.kind === 'problem' && value > 0) cellStyles[index] = 'flag-team';
        else if ((column.kind === 'decimal' || column.kind === 'rank') && Number.isFinite(value))
          cellStyles[index] = 'dec-team';
      });
      return { cells, style: 'row-team', cellStyles };
    }),
    freeze: { rows: 1, columns: 1 },
    filter: true
  };
}

/** The table as an Excel workbook: Teams, one tab per kind of scouting, All records, and a Guide. */
export function exportTableToXlsx(table, { eventKey = '', exportedAt = new Date() } = {}) {
  const styles = workbookStyles();
  const recordTabs = RECORD_TABS.map((spec) => recordSheet(table, spec)).filter((sheet) => sheet.rows.length);
  const allRecords = recordSheet(table, {
    name: 'All records',
    types: TYPE_ORDER,
    groups: EXPORT_GROUPS.map((group) => group.key),
    tab: 'BFBFBF'
  });
  const counts = TYPE_ORDER.map((type) => [type, table.rows.filter((row) => row.type === type).length]);
  const typeNames = {
    data: 'Data scouting report',
    performance: 'Performance scouting report',
    robot: 'Robot scouting report',
    pit: 'Pit scouting',
    ranking: 'Match ranking (the scouting group ranks all six robots)',
    note: 'Scout note',
    issue: 'Pit problem (a problem sent to the pit crew)'
  };
  const guide = {
    name: 'Guide',
    tabColor: '000000',
    columns: [
      { header: 'What', width: 44 },
      { header: 'Rows', width: 8 },
      { header: 'How to read it', width: 96 }
    ],
    rows: [
      {
        cells: [`Scouting export${eventKey ? `: ${eventKey}` : ''}`, '', ''],
        cellStyles: { 0: 'title' }
      },
      {
        cells: [`Exported ${when(exportedAt)} (local time)`, '', ''],
        cellStyles: { 0: 'subtitle' }
      },
      { cells: ['', '', ''] },
      ...[
        [
          'Teams',
          'One row per team: report counts, averages and problems. Green team = top quarter by balls scored, red = bottom quarter.'
        ],
        ...recordTabs.map((sheet) => [sheet.name, "That form's reports only, with only its questions as columns."]),
        ['All records', 'Every record on one tab, for filtering across kinds.']
      ].map(([what, how]) => ({ cells: [what, '', how], style: 'plain', cellStyles: { 0: 'label' } })),
      { cells: ['', '', ''] },
      ...counts
        .filter(([, count]) => count)
        .map(([type, count]) => ({
          cells: [typeNames[type], count, 'Rows of this kind share this color.'],
          style: `row-${type}`
        })),
      { cells: ['', '', ''] },
      ...RATING_FILLS.map((fill, index) => ({
        cells: [`Rating ${index + 1}`, '', ['Worst', 'Below average', 'Average', 'Good', 'Best'][index]],
        cellStyles: { 0: `rate-${index + 1}` }
      })),
      { cells: ['', '', ''] },
      ...[
        [
          'Filters',
          'Use the filter arrows on the header row; on All records, Record picks one kind and Team one robot.'
        ],
        ['Column colors', 'The colored heading over each block says which form those questions come from.'],
        ['Red text', 'Something went wrong: robot dead/stopped, a crash, break, beaching, jam, card or no-show.'],
        ['(as entered)', 'What the scout typed or picked, e.g. a range like 40-60.'],
        ['(estimate)', 'The number used for averages: the middle of a range, or the lower bound of "100+".'],
        ['Ratings (1-5)', '1 is worst, 5 is best. The "means" columns translate accuracy and BPS ratings.'],
        [
          'Defense (Teams tab)',
          'Effectiveness is the Data scouts\' 1-10 rating. Impact is how much less the robots it defended scored than in their undefended matches. Resistance is 10 minus the rating of defense played against it; "% kept" is its defended scoring over its undefended scoring.'
        ],
        ['Blank cell', 'Not asked on that form, or not answered. Never read a blank as 0.'],
        ['Times', 'Local time (the team timezone), when the report was submitted.']
      ].map(([what, how]) => ({ cells: [what, '', how], style: 'plain', cellStyles: { 0: 'label' } }))
    ]
  };
  return buildXlsx([teamSheet(table), ...recordTabs, allRecords, guide], styles);
}

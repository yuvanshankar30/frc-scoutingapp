// Data Viewer: turns an event's match and pit scouting reports into per-field summaries a page can draw. Each field
// (dataViewerFields.js) gets the answers it was given, a per-team summary and, by answer type, the numbers its chart
// needs. Blanks are "not scouted", never 0: averages and shares only count reports that answered.

import { compareMatchKeys, matchKeyOrder, matchLabel } from '$lib/matches/matchKeys.js';
import { displayValue, fieldApplies, readField, reportKind } from './dataViewerFields.js';

export const MATCH_TYPES = Object.freeze([
  { value: '', label: 'All matches' },
  { value: 'qual', label: 'Qualifications' },
  { value: 'playoff', label: 'Playoffs' },
  { value: 'practice', label: 'Practice' }
]);
export const REPORT_KIND_OPTIONS = Object.freeze([
  { value: '', label: 'All kinds' },
  { value: 'data', label: 'Data' },
  { value: 'performance', label: 'Performance' },
  { value: 'robot', label: 'Robot' }
]);
export const KIND_LABELS = Object.freeze({ data: 'Data', performance: 'Performance', robot: 'Robot' });

export const teamNumber = (key) => String(key || '').replace(/^frc/i, '');
const byTeamNumber = (a, b) => (Number(teamNumber(a)) || 0) - (Number(teamNumber(b)) || 0);

/** 'qual', 'playoff', 'practice' or '' (unreadable key). */
export function matchType(matchKey) {
  const [level] = matchKeyOrder(matchKey);
  if (level === 0) return 'practice';
  if (level === 1) return 'qual';
  if (level >= 2 && level <= 5) return 'playoff';
  return '';
}

/** The qualification number of a key, for the match range filter (playoffs and practice have none). */
const qualNumberOf = (matchKey) => (matchType(matchKey) === 'qual' ? matchKeyOrder(matchKey)[1] : null);

export const emptyFilters = () => ({ teams: [], matchType: '', fromMatch: null, toMatch: null, kind: '', section: '' });

/** The match reports left after the filters (pit reports only follow the team filter). */
export function filterRecords(records, form, filters = emptyFilters()) {
  const teams = new Set(filters.teams || []);
  const from = Number.isFinite(filters.fromMatch) ? filters.fromMatch : null;
  const to = Number.isFinite(filters.toMatch) ? filters.toMatch : null;
  return (records || []).filter((record) => {
    if (teams.size && !teams.has(record.team_key)) return false;
    if (form !== 'match') return true;
    if (filters.kind && reportKind(record) !== filters.kind) return false;
    if (filters.matchType && matchType(record.match_key) !== filters.matchType) return false;
    if (from !== null || to !== null) {
      const qual = qualNumberOf(record.match_key);
      if (qual === null) return false;
      if (from !== null && qual < from) return false;
      if (to !== null && qual > to) return false;
    }
    return true;
  });
}

/** The fields left after the kind and section filters. */
export function filterFields(fields, filters = emptyFilters()) {
  return (fields || []).filter((field) => {
    if (filters.section && field.section !== filters.section) return false;
    if (!filters.kind || field.form !== 'match') return true;
    if (field.kinds) return field.kinds.includes(filters.kind);
    return !field.kind || field.kind === filters.kind;
  });
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => (values.length ? sum(values) / values.length : null);

/** Every answer to a field, oldest match first: one entry per report that answered it. */
export function answersFor(field, records) {
  return (records || [])
    .map((record) => ({ record, value: readField(field, record) }))
    .filter(({ value }) => value !== null)
    .sort(
      (a, b) =>
        (a.record.match_key && b.record.match_key ? compareMatchKeys(a.record.match_key, b.record.match_key) : 0) ||
        byTeamNumber(a.record.team_key, b.record.team_key)
    )
    .map(({ record, value }) => ({
      id: record.id ?? `${record.team_key}:${record.match_key ?? ''}:${record.created_at ?? ''}`,
      teamKey: record.team_key,
      team: teamNumber(record.team_key),
      matchKey: record.match_key || null,
      match: record.match_key ? matchLabel(record.match_key) : null,
      kind: field.form === 'match' ? reportKind(record) : null,
      scout: String(record.scout_name || '').trim() || null,
      at: record.updated_at || record.created_at || null,
      value,
      text: displayValue(field, record)
    }));
}

/** How often each answer was given, most common first; options keep their form order when counts tie. */
export function answerCounts(field, answers) {
  const counts = new Map();
  for (const answer of answers)
    for (const value of Array.isArray(answer.value) ? answer.value : [answer.value])
      counts.set(String(value), (counts.get(String(value)) || 0) + 1);
  const order = field.type === 'yesno' ? ['Yes', 'No'] : field.options || [];
  const rank = (label) => {
    const index = order.indexOf(label);
    return index === -1 ? order.length : index;
  };
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) =>
      field.type === 'yesno' ? rank(a.label) - rank(b.label) : b.count - a.count || rank(a.label) - rank(b.label)
    );
}

/** How many answers gave each rating from 1 to max (a rating always shows every step, even unused ones). */
export function ratingCounts(field, answers) {
  const max = Math.max(1, Math.round(field.max || 5));
  const counts = Array.from({ length: max }, (_, index) => ({ label: String(index + 1), count: 0 }));
  for (const answer of answers) {
    const step = Math.min(max, Math.max(1, Math.round(answer.value)));
    counts[step - 1].count += 1;
  }
  return counts;
}

/**
 * One row per team: how many answers, and by type the average, min and max (numbers, ratings), the share of "Yes"
 * (yes/no), or the most common answers (choices, lists). Text fields only count answers.
 */
export function teamRows(field, answers) {
  const byTeam = new Map();
  for (const answer of answers) {
    if (!byTeam.has(answer.teamKey)) byTeam.set(answer.teamKey, []);
    byTeam.get(answer.teamKey).push(answer);
  }
  return [...byTeam]
    .sort(([a], [b]) => byTeamNumber(a, b))
    .map(([teamKey, list]) => {
      const row = { teamKey, team: teamNumber(teamKey), count: list.length };
      if (field.type === 'number' || field.type === 'rating') {
        const values = list.map((answer) => Number(answer.value));
        Object.assign(row, { average: mean(values), min: Math.min(...values), max: Math.max(...values) });
      } else if (field.type === 'yesno') {
        const yes = list.filter((answer) => answer.value === 'Yes').length;
        Object.assign(row, { yes, share: yes / list.length });
      } else if (field.type === 'choice' || field.type === 'multi') {
        row.top = answerCounts(field, list).slice(0, 3);
      }
      return row;
    });
}

/** Everything the page shows for one field: its answers, per-team rows and the event-wide numbers. */
export function summarizeField(field, records) {
  const answers = answersFor(field, records);
  const teams = teamRows(field, answers);
  const summary = { field, answers, teams, count: answers.length, teamCount: teams.length };
  if (field.type === 'number' || field.type === 'rating') {
    const values = answers.map((answer) => Number(answer.value));
    summary.average = mean(values);
    summary.min = values.length ? Math.min(...values) : null;
    summary.max = values.length ? Math.max(...values) : null;
  }
  if (field.type === 'rating') summary.distribution = ratingCounts(field, answers);
  if (field.type === 'choice' || field.type === 'multi' || field.type === 'yesno')
    summary.distribution = answerCounts(field, answers);
  if (field.type === 'yesno') {
    const yes = answers.filter((answer) => answer.value === 'Yes').length;
    summary.share = answers.length ? yes / answers.length : null;
  }
  return summary;
}

/** Fields grouped by section, in form order, each with its summary. */
export function groupBySection(fields, records) {
  const groups = [];
  for (const field of fields) {
    let group = groups[groups.length - 1];
    if (!group || group.id !== field.section) {
      group = { id: field.section, label: field.sectionLabel, fields: [] };
      groups.push(group);
    }
    group.fields.push(summarizeField(field, records));
  }
  return groups;
}

/** A number for a table cell: whole numbers stay whole, others get one decimal; nothing is "—". */
export function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}
export const formatShare = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');

/** The teams in the reports, for the team filter: [{ value, number, name }]. */
export function teamOptions(records, names = new Map()) {
  return [...new Set((records || []).map((record) => record.team_key).filter(Boolean))]
    .sort(byTeamNumber)
    .map((key) => ({ value: key, number: teamNumber(key), name: names.get(key) || '' }));
}

/** The highest qualification number scouted, for the match range filter. */
export function lastQualNumber(records) {
  return Math.max(0, ...(records || []).map((record) => qualNumberOf(record.match_key) ?? 0));
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const textValue = String(value);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(textValue) && !/^-?\d+(\.\d+)?$/.test(textValue) ? `'${textValue}` : textValue;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * The current view as CSV: one row per report, with the shown fields as columns. Pit reports have no match, kind
 * or scout-by-match columns of their own, so those stay blank.
 */
export function viewToCsv(form, fields, records) {
  const reports = [...(records || [])].sort(
    (a, b) =>
      (a.match_key && b.match_key ? compareMatchKeys(a.match_key, b.match_key) : 0) ||
      byTeamNumber(a.team_key, b.team_key)
  );
  const fixed =
    form === 'match'
      ? [
          ['Match', (r) => (r.match_key ? matchLabel(r.match_key) : null)],
          ['Team', (r) => teamNumber(r.team_key)],
          ['Report', (r) => KIND_LABELS[reportKind(r)]],
          ['Scout', (r) => r.scout_name]
        ]
      : [
          ['Team', (r) => teamNumber(r.team_key)],
          ['Scout', (r) => r.scout_name]
        ];
  const rows = [
    [...fixed.map(([header]) => header), ...fields.map((field) => field.label)],
    ...reports.map((record) => [
      ...fixed.map(([, read]) => read(record)),
      ...fields.map((field) => displayValue(field, record))
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** What a field's chart draws: 'teams' (bars per team), 'counts' (bars per answer) or 'text' (no chart). */
export function chartKind(field) {
  if (field.type === 'number' || field.type === 'rating' || field.type === 'yesno') return 'teams';
  if (field.type === 'choice' || field.type === 'multi') return 'counts';
  return 'text';
}

/** Rows for TeamBars, best team first: averages with their range, or the share of "Yes". */
export function teamBarRows(summary) {
  const { field, teams } = summary;
  if (field.type === 'yesno')
    return teams
      .map((row) => ({
        key: row.teamKey,
        label: row.team,
        value: row.share,
        text: `${formatShare(row.share)} · ${row.yes}/${row.count}`
      }))
      .sort((a, b) => b.value - a.value || Number(a.label) - Number(b.label));
  return teams
    .map((row) => ({
      key: row.teamKey,
      label: row.team,
      value: row.average,
      min: row.min,
      max: row.max,
      text: formatNumber(row.average)
    }))
    .sort((a, b) => b.value - a.value || Number(a.label) - Number(b.label));
}

/** The scale a field's team bars use: a rating's top step, 100% for yes/no, else the largest answer. */
export const barScale = (field) => (field.type === 'rating' ? field.max || 5 : field.type === 'yesno' ? 1 : null);

/** The one-line headline under a field's name: "avg 4.2 · 1–5", "62% yes", "Scorer most common". */
export function headline(summary) {
  if (!summary.count) return 'Not scouted yet';
  const { field } = summary;
  if (field.type === 'number' || field.type === 'rating')
    return `avg ${formatNumber(summary.average)} · ${formatNumber(summary.min)}–${formatNumber(summary.max)}${field.type === 'rating' ? ` of ${field.max}` : ''}`;
  if (field.type === 'yesno') return `${formatShare(summary.share)} yes`;
  if (field.type === 'choice' || field.type === 'multi') return `Most common: ${summary.distribution[0].label}`;
  return `${summary.count} written ${summary.count === 1 ? 'answer' : 'answers'}`;
}

/** A record's stable id for links: its database id, or team, match and time when it has none. */
export const recordId = (record) =>
  String(record?.id ?? `${record?.team_key}:${record?.match_key ?? ''}:${record?.created_at ?? ''}`);

/** Scout entries, latest match first (then team), narrowed by a search over team, match, kind and scout. */
export function entryList(records, query = '') {
  const needle = String(query || '')
    .trim()
    .toLowerCase();
  return [...(records || [])]
    .sort(
      (a, b) =>
        (a.match_key && b.match_key ? compareMatchKeys(b.match_key, a.match_key) : 0) ||
        byTeamNumber(a.team_key, b.team_key) ||
        String(a.report_kind || '').localeCompare(String(b.report_kind || ''))
    )
    .map((record) => ({
      id: recordId(record),
      record,
      team: teamNumber(record.team_key),
      match: record.match_key ? matchLabel(record.match_key) : '—',
      kind: reportKind(record),
      scout: String(record.scout_name || '').trim() || null,
      at: record.updated_at || record.created_at || null
    }))
    .filter(
      (entry) =>
        !needle ||
        [entry.team, entry.match, KIND_LABELS[entry.kind], entry.scout]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
    );
}

/** One report's answers by section: every field the report asked, with its answer or null. */
export function entrySections(fields, record) {
  const sections = [];
  for (const field of fields || []) {
    if (!fieldApplies(field, record)) continue;
    let section = sections[sections.length - 1];
    if (!section || section.id !== field.section) {
      section = { id: field.section, label: field.sectionLabel, answers: [] };
      sections.push(section);
    }
    section.answers.push({ field, text: displayValue(field, record) });
  }
  return sections;
}

/** The items before and after the one with this id, for previous/next links. */
export function neighbors(items, id, idOf = (item) => item.id) {
  const index = (items || []).findIndex((item) => idOf(item) === id);
  if (index === -1) return { previous: null, next: null, index: -1, total: items?.length || 0 };
  return { previous: items[index - 1] ?? null, next: items[index + 1] ?? null, index, total: items.length };
}

/** Matches at each end of a field's trend: a team needs twice this many scouted matches to have one. */
export const TREND_MATCHES = 3;

/**
 * Who is improving on a number or rating field: each team's mean over its last k scouted matches minus its first k,
 * in played order (several reports on one match are averaged first). Teams with fewer than 2k matches are listed in
 * notEnough instead. Rows are best improver first, ready for RankedBars.
 */
export function fieldTrend(summary, k = TREND_MATCHES) {
  const { field, answers } = summary;
  if (field.type !== 'number' && field.type !== 'rating') return { rows: [], notEnough: [] };
  const byTeam = new Map();
  for (const answer of answers) {
    if (!answer.matchKey) continue;
    if (!byTeam.has(answer.teamKey)) byTeam.set(answer.teamKey, new Map());
    const matches = byTeam.get(answer.teamKey);
    if (!matches.has(answer.matchKey)) matches.set(answer.matchKey, []);
    matches.get(answer.matchKey).push(Number(answer.value));
  }
  const rows = [];
  const notEnough = [];
  for (const [teamKey, matches] of byTeam) {
    const values = [...matches].sort(([a], [b]) => compareMatchKeys(a, b)).map(([, list]) => mean(list));
    if (values.length < 2 * k) {
      notEnough.push(teamNumber(teamKey));
      continue;
    }
    const delta = mean(values.slice(-k)) - mean(values.slice(0, k));
    rows.push({
      key: teamKey,
      label: teamNumber(teamKey),
      teamKey,
      value: Math.abs(delta) < 1e-9 ? 0 : delta,
      n: values.length
    });
  }
  rows.sort((a, b) => b.value - a.value || Number(a.label) - Number(b.label));
  return { rows, notEnough: notEnough.sort((a, b) => Number(a) - Number(b)) };
}

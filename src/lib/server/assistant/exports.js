import { csvCell } from '$lib/server/scouting/scoutingCsvExport.js';

// CSV files the assistant can hand to the person. The file is built on the server from the event data the
// person can already read, attached to the response, and downloaded by the browser; nothing is written anywhere.
// The model sees only a summary (rows, columns, file name), never the file. Cells go through csvCell, which
// defuses spreadsheet formulas in user-entered text.

const MAX_BYTES = 3_000_000;
// Account ids and bulky drawing data never go in an export.
const DROP = new Set(['created_by', 'updated_by', 'reviewer_id', 'id', 'auto_path', 'email', 'role', 'permissions']);

function toCsv(rows, preferred = []) {
  const found = new Set(rows.flatMap((r) => Object.keys(r || {})));
  const columns = [
    ...preferred.filter((c) => found.has(c)),
    ...[...found].filter((c) => !preferred.includes(c) && !DROP.has(c)).sort()
  ];
  const body = rows.map((row) => columns.map((c) => csvCell(row[c])).join(','));
  return { columns, content: `\uFEFF${[columns.map(csvCell).join(','), ...body].join('\r\n')}\r\n` };
}

const teamOnly = (rows, key) => (key ? rows.filter((r) => r.team_key === key) : rows);

/** dataset name -> { label, pick(snapshot, extras, teamKey) => rows, preferred columns }. Extras are the lazily loaded datasets. */
export const DATASETS = {
  match_reports: {
    label: 'match scouting reports',
    pick: (s, x, t) => teamOnly(s.matchEntries, t),
    preferred: ['event_key', 'match_key', 'team_key', 'scout']
  },
  scout_notes: {
    label: 'scout notes',
    pick: (s, x, t) => teamOnly(s.notes, t),
    preferred: ['match_key', 'team_key', 'scout', 'notes']
  },
  pit_profiles: {
    label: 'pit scouting profiles',
    pick: (s, x, t) => teamOnly(s.pitEntries, t),
    preferred: ['team_key', 'scout']
  },
  pit_problems: {
    label: 'pit problem reports',
    pick: (s, x, t) => teamOnly(s.problems, t),
    preferred: ['team_key', 'severity', 'resolved', 'summary', 'detail']
  },
  quick_scout_events: {
    label: 'quick-scout tap events',
    pick: (s, x, t) => teamOnly(s.events, t),
    preferred: ['match_key', 'team_key', 'phase', 'event_type', 'event_value']
  },
  team_summary: {
    label: 'one row per team: power rank, averages and rates',
    pick: (s, x, t) => (t ? x.teamSummary.filter((r) => `frc${r.team}` === t) : x.teamSummary),
    preferred: ['team', 'power_rank', 'scout_power']
  },
  match_rankings: {
    label: 'post-match robot rankings (one row per robot per match)',
    pick: (s, x, t) =>
      teamOnly(
        (x.rankings || []).flatMap((r) =>
          r.ranked_team_keys.map((team_key, i) => ({ match_key: r.match_key, position: i + 1, team_key }))
        ),
        t
      ),
    preferred: ['match_key', 'position', 'team_key']
  },
  picklist: {
    label: 'the shared picklist',
    pick: (s, x, t) => teamOnly(x.picklist || [], t),
    preferred: ['position', 'team_key', 'team_number', 'nickname', 'note']
  }
};

const slug = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 60);

/** A safe download name: letters, digits, dot, dash and underscore only, always ending .csv. */
export function safeFilename(name, fallback = 'export') {
  const base = slug(String(name ?? '').replace(/\.csv$/i, '')) || fallback;
  return `${base}.csv`;
}

function finish(rows, preferred, filename, wanted) {
  let { columns, content } = toCsv(rows, preferred);
  if (wanted?.length) {
    const missing = wanted.filter((c) => !columns.includes(c));
    if (missing.length)
      return {
        ok: false,
        error: `Those columns are not in this data: ${missing.join(', ')}. Available: ${columns.join(', ')}.`
      };
    ({ columns, content } = toCsv(
      rows.map((r) => Object.fromEntries(wanted.map((c) => [c, r[c]]))),
      wanted
    ));
  }
  if (content.length > MAX_BYTES)
    return {
      ok: false,
      error: `That export is too large (${Math.round(content.length / 1e6)} MB). Narrow it to fewer teams, matches or columns.`
    };
  return { ok: true, rows: rows.length, columns, filename, content };
}

/**
 * Build an export of one dataset, optionally narrowed to some teams, some matches and some columns, so a
 * person gets exactly what they asked for instead of everything.
 * Returns { ok, rows, columns, filename, content } or { ok: false, error }.
 */
export function buildExport(
  name,
  snapshot,
  extras,
  { teamKey = null, teamKeys = [], matchKeys = [], columns = null } = {}
) {
  const dataset = DATASETS[name];
  if (!dataset) return { ok: false, error: `Unknown dataset. Choose one of: ${Object.keys(DATASETS).join(', ')}.` };
  let rows = dataset.pick(snapshot, extras, teamKey) || [];
  const teams = new Set((teamKeys || []).filter(Boolean));
  if (teams.size) rows = rows.filter((r) => teams.has(r.team_key) || teams.has(`frc${r.team}`));
  const matches = new Set((matchKeys || []).filter(Boolean));
  if (matches.size) rows = rows.filter((r) => matches.has(r.match_key));
  if (!rows.length) {
    const narrowed = [
      teamKey && `team ${teamKey.replace(/^frc/, '')}`,
      teams.size && `teams ${[...teams].map((t) => t.replace(/^frc/, '')).join(', ')}`,
      matches.size && `matches ${[...matches].map((m) => m.replace(/^.*_/, '')).join(', ')}`
    ].filter(Boolean);
    return {
      ok: false,
      error: `There are no ${dataset.label}${narrowed.length ? ` for ${narrowed.join(' and ')}` : ''} to export.`
    };
  }
  const tag = [
    teamKey || (teams.size ? [...teams].map((t) => t.replace(/^frc/, '')).join('-') : ''),
    matches.size ? [...matches].map((m) => m.replace(/^.*_/, '')).join('-') : ''
  ]
    .filter(Boolean)
    .join('-');
  return finish(
    rows,
    dataset.preferred,
    safeFilename(`${snapshot.eventKey}-${name.replace(/_/g, '-')}${tag ? `-${tag}` : ''}`),
    columns
  );
}

/** A table the assistant assembled itself (for example a ranking it computed): bounded, and cells are plain text or numbers. */
export function buildCustomExport(snapshot, { filename, columns, rows }) {
  if (!Array.isArray(columns) || !columns.length || columns.length > 30)
    return { ok: false, error: 'Give 1 to 30 column names.' };
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: 'There are no rows to export.' };
  if (rows.length > 1000) return { ok: false, error: 'At most 1000 rows can be exported this way.' };
  const names = columns.map((c) => String(c).replace(/\s+/g, ' ').trim().slice(0, 60));
  if (names.some((c) => !c) || new Set(names).size !== names.length)
    return { ok: false, error: 'Column names must be non-empty and different from each other.' };
  const cell = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
  const table = rows.map((row) =>
    Object.fromEntries(names.map((c, i) => [c, cell(Array.isArray(row) ? row[i] : (row?.[columns[i]] ?? row?.[c]))]))
  );
  return finish(table, names, safeFilename(filename, `${snapshot.eventKey}-custom`), null);
}

/** Rows read straight from an allowed table (see queryTable.js) written out as a file. */
export function buildQueryExport(snapshot, { table, rows }, filename) {
  if (!rows?.length) return { ok: false, error: 'That query returned no rows to export.' };
  return finish(rows, [], safeFilename(filename, `${snapshot.eventKey}-${String(table).replace(/_/g, '-')}`), null);
}

// Read access to the scouting tables, for questions no purpose-built tool covers. It runs with the CALLER'S
// database client, so row-level security still decides what comes back, and it is scoped to the open event.
// Only the tables listed here can be read: account, role, permission, roster-key, assignment, deadline and
// settings tables (Scouting Admin territory) are deliberately absent, and columns that identify accounts are
// stripped from every row.

import { escapeMatchKeyPrefix } from '$lib/scouting/eventCode.js';

export const TABLES = {
  match_scout_entries: {
    scope: 'event_key',
    about: 'one row per scout report of a robot in a match: auto, balls scored, ratings, notes, incidents'
  },
  scout_notes: { scope: 'match_like', about: 'free-text notes on a robot in a match, with ranking impact' },
  scout_data_events: { scope: 'match_like', about: 'quick-scout tap events (phase, event type, value)' },
  pit_scout_entries: { scope: 'event_key', about: 'pit scouting profile per team' },
  pit_problem_reports: { scope: 'event_key', about: 'problems logged in the pits, with severity and whether resolved' },
  scouting_match_rankings: { scope: 'event_key', about: "the group's best-to-worst ordering of robots per match" },
  scouting_pairwise_votes: { scope: 'event_key', about: 'head-to-head votes between two teams' },
  scouting_picklist: { scope: 'event_key', about: 'the shared alliance-selection picklist' },
  scouting_practice_matches: { scope: 'event_key', about: 'practice match labels' }
};

// Never returned, whichever table: they identify accounts or hold roles.
const STRIP = new Set([
  'created_by',
  'updated_by',
  'reviewer_id',
  'released_by',
  'email',
  'role',
  'permissions',
  'general_role',
  'team_role',

  'slack_user_id',
  'slack_dm_channel',
  'banned'
]);
const OPS = { eq: 'eq', neq: 'neq', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', like: 'like', ilike: 'ilike' };
const COLUMN = /^[a-z][a-z0-9_]{0,48}$/;
const MAX_LIMIT = 100;
const MAX_CHARS = 14_000;

export function listTables() {
  return {
    tables: Object.entries(TABLES).map(([name, t]) => ({ table: name, about: t.about })),
    note: "Scoped to the open event. Call query_table with limit 1 to see a table's columns. Accounts, roles, assignments, deadlines and settings are not readable."
  };
}

/**
 * @param {object} ctx   { db, eventKey }
 * @param {object} args  { table, columns?, filters?: [{column, op, value}], order_by?, descending?, limit?, count_only? }
 */
export async function queryTable(ctx, args = {}, { forExport = false } = {}) {
  const spec = TABLES[args.table];
  if (!spec) return { error: `That table is not readable. Readable tables: ${Object.keys(TABLES).join(', ')}.` };
  if (!ctx?.db) return { error: 'No database connection is available.' };

  const columns = Array.isArray(args.columns) ? args.columns.map(String) : [];
  const filters = Array.isArray(args.filters) ? args.filters : [];
  for (const column of [...columns, ...filters.map((f) => f?.column), args.order_by].filter(Boolean)) {
    if (!COLUMN.test(column)) return { error: `"${column}" is not a valid column name.` };
    if (STRIP.has(column)) return { error: `The column "${column}" is not available.` };
  }
  for (const f of filters) {
    if (!f || !OPS[f.op]) return { error: `A filter needs an op of: ${Object.keys(OPS).join(', ')}.` };
    if (f.value === undefined || f.value === null || typeof f.value === 'object')
      return { error: 'A filter value must be a string, number or boolean.' };
  }

  const cap = forExport ? 5000 : MAX_LIMIT;
  const limit = Math.min(Math.max(1, Math.trunc(Number(args.limit)) || (forExport ? cap : 25)), cap);
  let query = ctx.db
    .from(args.table)
    .select(columns.length ? columns.join(',') : '*', args.count_only ? { count: 'exact', head: true } : undefined);
  const matchLike =
    escapeMatchKeyPrefix(ctx.eventKey) || `${String(ctx.eventKey || '').replace(/[\\%_]/g, '\\$&')}\\_%`;
  query = spec.scope === 'event_key' ? query.eq('event_key', ctx.eventKey) : query.ilike('match_key', matchLike);
  for (const f of filters) query = query[OPS[f.op]](f.column, f.value);
  if (args.order_by) query = query.order(args.order_by, { ascending: !args.descending });
  if (!args.count_only) query = query.limit(limit);

  let result;
  try {
    result = await query;
  } catch (error) {
    return { error: `The query failed: ${error.message}` };
  }
  if (result.error) return { error: `The query failed: ${String(result.error.message).slice(0, 200)}` };
  if (args.count_only) return { table: args.table, count: result.count ?? 0 };

  const rows = (result.data || []).map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !STRIP.has(k))));
  if (forExport) return { table: args.table, rows }; // the file is built from all of them; the model never sees these
  let text = JSON.stringify(rows);
  let kept = rows;
  while (text.length > MAX_CHARS && kept.length > 1) {
    kept = kept.slice(0, Math.ceil(kept.length / 2));
    text = JSON.stringify(kept);
  }
  return {
    table: args.table,
    rows: kept.length,
    truncated: kept.length < rows.length || rows.length === limit,
    columns_available: rows[0] ? Object.keys(rows[0]) : [],
    data: kept
  };
}

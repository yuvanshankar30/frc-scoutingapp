import { selectPitScoutEntries } from '$lib/server/scouting/pitScoutingSchema.js';
import { relabelTbaPayload, tbaEventKeyFor, tbaMatchKeyFor } from '$lib/server/scouting/tbaEventLink.js';
import { escapeMatchKeyPrefix } from '$lib/scouting/eventCode.js';
import { tbaFetch } from '$lib/server/integrations/tba.js';

// Everything the assistant may read about one event, loaded with the CALLER'S database client so Postgres
// row-level security decides what they can see. Read-only: nothing here writes.

const LIMIT = 20000;

/** Group post-match rankings, head-to-head votes, the shared picklist and practice matches. Each never throws. */
const safe = async (promise) => {
  try {
    const r = await promise;
    return r.error ? [] : r.data || [];
  } catch {
    return [];
  }
};
export const loadRankings = (db, eventKey) =>
  safe(
    db
      .from('scouting_match_rankings')
      .select('match_key,ranked_team_keys,updated_at')
      .eq('event_key', eventKey)
      .limit(LIMIT)
  );
export const loadVotes = (db, eventKey) =>
  safe(
    db
      .from('scouting_pairwise_votes')
      .select('team_a_key,team_b_key,winner_team_key')
      .eq('event_key', eventKey)
      .limit(LIMIT)
  );
export const loadPicklist = (db, eventKey) =>
  safe(
    db
      .from('scouting_picklist')
      .select('id,team_key,team_number,nickname,position,note')
      .eq('event_key', eventKey)
      .order('position')
      .limit(500)
  );
export const loadPractice = (db, eventKey) =>
  safe(db.from('scouting_practice_matches').select('match_key,label').eq('event_key', eventKey).limit(500));

/**
 * Names for the people who wrote reports: only id and full name are ever requested (never email, role,
 * permissions or roster keys). Falls back to nothing when row-level security hides a profile.
 */
export async function loadScoutNames(db, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await safe(db.from('user_profiles').select('id,full_name').in('id', unique));
  return new Map(rows.filter((r) => r.full_name).map((r) => [r.id, r.full_name]));
}

/** The Blue Alliance (read-only, key stays on the server). Returns parsed JSON, or null on any failure. */
export async function tbaGet(ctx, path) {
  const authKey = ctx?.env?.TBA_API_KEY;
  if (!authKey) return null;
  try {
    // A competition code can track a different TBA event; ask about that one and answer in the code's keys.
    const db = ctx.db || null;
    const [, kind, id] = String(path).match(/^\/(event|match)\/([^/]+)/) || [];
    const code =
      kind === 'event' ? decodeURIComponent(id) : kind === 'match' ? decodeURIComponent(id).split('_')[0] : '';
    const tbaKey = code ? await tbaEventKeyFor(code, db) : '';
    const tbaPath =
      code && tbaKey !== code
        ? path.replace(
            `/${kind}/${id}`,
            `/${kind}/${encodeURIComponent(kind === 'event' ? tbaKey : await tbaMatchKeyFor(decodeURIComponent(id), db))}`
          )
        : path;
    const response = await tbaFetch(tbaPath, { authKey, fetchImpl: ctx.fetch || fetch });
    return response.ok ? relabelTbaPayload(await response.json(), tbaKey, code) : null;
  } catch {
    return null;
  }
}

export async function loadEventSnapshot(db, eventKey, env = {}) {
  const like = escapeMatchKeyPrefix(eventKey) || `${String(eventKey || '').replace(/[\\%_]/g, '\\$&')}\\_%`;
  const [events, matchEntries, notes, problems, pit] = await Promise.all([
    db
      .from('scout_data_events')
      .select('match_key,match_number,team_key,phase,event_type,event_value,role,created_at')
      .ilike('match_key', like)
      .limit(LIMIT),
    db.from('match_scout_entries').select('*').eq('event_key', eventKey).order('match_key').limit(LIMIT),
    db.from('scout_notes').select('*').ilike('match_key', like).order('created_at', { ascending: false }).limit(LIMIT),
    db
      .from('pit_problem_reports')
      .select('id,team_key,match_key,summary,detail,severity,resolved,created_at')
      .eq('event_key', eventKey)
      .limit(LIMIT),
    selectPitScoutEntries(db, (query) => query.eq('event_key', eventKey).order('team_key', { ascending: true }))
  ]);
  const failed = [events, matchEntries, notes, problems, pit].find((result) => result.error);
  if (failed) throw new Error(failed.error.message);
  const matchRows = matchEntries.data || [];
  const noteRows = notes.data || [];
  const pitRows = pit.data || [];
  const names = await loadScoutNames(
    db,
    [...matchRows, ...noteRows, ...pitRows].filter((r) => !r.scout_name).map((r) => r.created_by)
  );
  const withScout = (row) => ({ ...row, scout: row.scout_name || names.get(row.created_by) || null });
  return {
    eventKey,
    ctx: { db, eventKey, env },
    events: events.data || [],
    matchEntries: matchRows.map(withScout),
    notes: noteRows.map(withScout),
    problems: problems.data || [],
    pitEntries: pitRows.map(withScout)
  };
}

// Match reports whose match box couldn't be read into a real match key (old free-text entries like
// "einstein match 10"), listed in Scouting Admin so someone can set the right match. See #123.
import { MATCH_KEY_PATTERN, canonicalMatchKey } from '$lib/matches/matchKeys.js';
import { resolveScoutedBy } from '$lib/server/scouting/scoutIdentity.js';

/** True when a stored key is a canonical key for its own event. */
export const isCanonicalReportKey = (row) =>
  MATCH_KEY_PATTERN.test(String(row?.match_key || '')) && String(row.match_key).startsWith(`${row.event_key}_`);

export async function listMatchKeyReview(db) {
  const [reports, problems] = await Promise.all([
    db
      .from('match_scout_entries')
      .select('id, event_key, match_key, match_label, team_key, report_kind, scout_name, created_by, updated_at')
      .order('updated_at', { ascending: false }),
    db
      .from('pit_problem_reports')
      .select('id, event_key, match_key, match_label, team_key, summary, resolved, created_at')
      .not('match_key', 'is', null)
      .order('created_at', { ascending: false })
  ]);
  if (reports.error) return { error: reports.error.message };
  if (problems.error) return { error: problems.error.message };
  return {
    data: {
      reports: (reports.data || []).filter((row) => !isCanonicalReportKey(row)),
      problems: (problems.data || []).filter((row) => !isCanonicalReportKey(row))
    }
  };
}

/** Sets the match of one listed row from what an admin typed ("12", "sf2m1"). */
export async function fixMatchKey(db, { kind, id, match }) {
  const table = kind === 'problem' ? 'pit_problem_reports' : kind === 'report' ? 'match_scout_entries' : null;
  if (!table || !id) return { status: 400, error: 'Choose a report to fix.' };
  const columns =
    kind === 'report' ? 'id, event_key, match_key, created_by, scout_name, scouted_by' : 'id, event_key, match_key';
  const { data: row, error } = await db.from(table).select(columns).eq('id', id).maybeSingle();
  if (error) return { status: 500, error: error.message };
  if (!row) return { status: 404, error: 'That report no longer exists.' };
  const match_key = canonicalMatchKey(match, row.event_key);
  if (!match_key)
    return {
      status: 400,
      error: `"${String(match || '').trim()}" isn't a match number. Use 12 for Qual 12, or sf2m1 / f1m2 for playoffs.`
    };
  const patch = { match_key };
  // A row held for review was skipped by the scouted_by backfill (#123 step 3); link its scout now.
  if (kind === 'report' && !row.scouted_by && row.created_by) {
    const { data: owner } = await db.from('user_profiles').select('full_name').eq('id', row.created_by).maybeSingle();
    const scoutedBy = await resolveScoutedBy(db, {
      actorId: row.created_by,
      actorName: owner?.full_name,
      scoutName: row.scout_name
    });
    if (scoutedBy) patch.scouted_by = scoutedBy;
  }
  const { data, error: updateError } = await db.from(table).update(patch).eq('id', id).select('id, match_key').single();
  if (updateError) {
    // 23505: the same scout already has a report (or the robot an open problem) for that match.
    const message =
      updateError.code === '23505'
        ? 'There is already a report for that robot and match from the same scout. Remove one of them instead.'
        : updateError.message;
    return { status: updateError.code === '23505' ? 409 : 500, error: message };
  }
  return { data };
}

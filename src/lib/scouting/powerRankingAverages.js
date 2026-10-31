// Scouts each rank the robots they watched in a match (Performance > Power ranking). This turns those
// per-scout rankings into one average per robot per match, then one average per robot across matches.
//
// A scout who skipped a robot ("Didn't watch") simply has no rank for it, so each robot's average uses only
// the scouts who ranked it, and `count` says how many that was. One scout covering two robots in the same
// match files two reports with the same ranking; only their most recent one counts, so nobody gets two votes.
import { round } from '$lib/stats.js';

const latestFirst = (left, right) =>
  String(right.updated_at || right.created_at || '').localeCompare(String(left.updated_at || left.created_at || ''));

/** The ranking each scout gave in each match: Map<match_key, Map<scout, ranking>>. */
function rankingsByMatch(entries) {
  const matches = new Map();
  for (const entry of [...(entries || [])].sort(latestFirst)) {
    const ranking = entry?.power_ranking;
    if (!entry?.match_key || !ranking || typeof ranking !== 'object' || !Object.keys(ranking).length) continue;
    const scout = entry.created_by || entry.scout_name || `entry:${entry.id}`;
    if (!matches.has(entry.match_key)) matches.set(entry.match_key, new Map());
    const scouts = matches.get(entry.match_key);
    if (!scouts.has(scout)) scouts.set(scout, ranking);
  }
  return matches;
}

/**
 * @returns {{ matches: Array<{ match_key: string, scouts: number, teams: Array<{ team_key: string, average: number, count: number }> }>,
 *             teams: Array<{ team_key: string, average: number, matches: number, rankings: number }> }}
 */
export function averagePowerRankings(entries) {
  const matches = [];
  const perTeam = new Map();
  for (const [matchKey, scouts] of rankingsByMatch(entries)) {
    const totals = new Map();
    for (const ranking of scouts.values()) {
      for (const [teamKey, rank] of Object.entries(ranking)) {
        if (!Number.isFinite(Number(rank))) continue;
        const total = totals.get(teamKey) || { sum: 0, count: 0 };
        total.sum += Number(rank);
        total.count += 1;
        totals.set(teamKey, total);
      }
    }
    const teams = [...totals]
      .map(([team_key, { sum, count }]) => ({ team_key, average: round(sum / count), count }))
      .sort(
        (left, right) =>
          left.average - right.average || right.count - left.count || left.team_key.localeCompare(right.team_key)
      );
    matches.push({ match_key: matchKey, scouts: scouts.size, teams });
    for (const team of teams) {
      const total = perTeam.get(team.team_key) || { sum: 0, matches: 0, rankings: 0 };
      total.sum += team.average;
      total.matches += 1;
      total.rankings += team.count;
      perTeam.set(team.team_key, total);
    }
  }
  const matchNumber = (key) => Number(String(key).match(/(\d+)$/)?.[1]) || 0;
  matches.sort(
    (left, right) =>
      matchNumber(left.match_key) - matchNumber(right.match_key) || left.match_key.localeCompare(right.match_key)
  );
  const teams = [...perTeam]
    .map(([team_key, { sum, matches: count, rankings }]) => ({
      team_key,
      average: round(sum / count),
      matches: count,
      rankings
    }))
    .sort(
      (left, right) =>
        left.average - right.average || right.matches - left.matches || left.team_key.localeCompare(right.team_key)
    );
  return { matches, teams };
}

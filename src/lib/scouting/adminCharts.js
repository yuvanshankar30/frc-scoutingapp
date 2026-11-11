// Numbers behind the Scouting Admin overview charts: event-wide coverage, never per-scout tracking. Pure, so they can
// be tested.
import { reportKindOf, REPORT_KIND_LABELS } from '$lib/scouting/reportKinds.js';
import { canonicalScoutMatchSuffix } from '$lib/scouting/scoutAssignmentCompletion.js';
import { compareMatchKeys, shortMatchLabel } from '$lib/matches/matchKeys.js';

/** Robots with at least one report in each match, out of the six on the field, in match order. */
export function robotsReportedPerMatch(reports) {
  const byMatch = new Map();
  for (const report of reports || []) {
    const id = canonicalScoutMatchSuffix(report?.match_key);
    if (!id || !report?.team_key) continue;
    if (!byMatch.has(id)) byMatch.set(id, { matchKey: report.match_key, teams: new Set() });
    byMatch.get(id).teams.add(String(report.team_key).toLowerCase());
  }
  return [...byMatch.values()]
    .sort((a, b) => compareMatchKeys(a.matchKey, b.matchKey))
    .map(({ matchKey, teams }) => ({ matchKey, label: shortMatchLabel(matchKey), value: Math.min(6, teams.size) }));
}

/** How many reports of each kind (Data / Performance / Robot). */
export function reportKindMix(reports) {
  const counts = { data: 0, performance: 0, robot: 0 };
  for (const report of reports || []) counts[reportKindOf(report)] += 1;
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ label: REPORT_KIND_LABELS[kind], count }));
}

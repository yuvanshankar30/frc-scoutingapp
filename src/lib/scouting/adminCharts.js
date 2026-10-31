// Numbers behind the Scouting Admin overview charts. Pure, so they can be tested.
import { findDisputes, scoutOf } from '$lib/scouting/scoutData.js';
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

/** Reports filed by each scout, most first. */
export function reportsPerScout(reports) {
  const counts = new Map();
  for (const report of reports || []) {
    const name = scoutOf(report);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** How many reports of each kind (Data / Performance / Robot). */
export function reportKindMix(reports) {
  const counts = { data: 0, performance: 0, robot: 0 };
  for (const report of reports || []) counts[reportKindOf(report)] += 1;
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({ label: REPORT_KIND_LABELS[kind], count }));
}

/**
 * Scouts whose ball counts disagree strongly with another scout on the same robot and match
 * (findDisputes), as a count per scout, most first.
 */
export function disagreementsPerScout(reports) {
  const disputes = findDisputes(reports || []);
  const counts = new Map();
  for (const report of reports || []) {
    if (!disputes.has(report.id)) continue;
    const name = scoutOf(report);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

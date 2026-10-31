// A scout's own open assignments, as Home and My Reports show them. Match assignments are stored
// as one board ('data'), and the kind of scouting a person does there - Data, Performance or
// Robot - comes from the role they hold on Scouting Admin > People (see reportKinds.js).
import { defaultReportKind, REPORT_KIND_ROLES } from '$lib/scouting/reportKinds.js';
import { canonicalScoutMatchSuffix } from '$lib/scouting/scoutAssignmentCompletion.js';
import { compareMatchKeys, matchLabel } from '$lib/matches/matchKeys.js';

export const KIND_LABELS = Object.freeze({
  data: 'Data scout',
  performance: 'Performance scout',
  robot: 'Robot scout'
});
const OTHER_TYPE_LABELS = Object.freeze({ note: 'Note scout', quick: 'Quick scout' });

/** The match-scouting kind a person's roles give them; data when they hold none of the three scout roles. */
export const assignmentKind = (rosterKeys) => defaultReportKind(rosterKeys);

/** Every scout role a person holds, in Data, Performance, Robot order. */
export function scoutKinds(rosterKeys) {
  const keys = new Set(
    (rosterKeys || []).map((key) =>
      String(key || '')
        .trim()
        .toLowerCase()
    )
  );
  return Object.entries(REPORT_KIND_ROLES)
    .filter(([role]) => keys.has(role.toLowerCase()))
    .map(([, kind]) => kind);
}

/** What an assignment asks for: "Performance scout" for a match assignment, "Note scout" for the others. */
export function assignmentRoleLabel(row) {
  if (row?.scouting_type && row.scouting_type !== 'data') return OTHER_TYPE_LABELS[row.scouting_type] || 'Scouting';
  return KIND_LABELS[row?.report_kind] || KIND_LABELS.data;
}

const teamNumber = (key) => String(key || '').replace(/^frc/i, '');

/** "Qual 12", "Semifinal 2 Match 1" from a match key such as 2026cabl_qm12. */

/** The TBA match an assignment points at, matched on its canonical suffix (qm12, sf2m1) rather than the full key. */
export function scheduledMatch(matchKey, matches) {
  const wanted = canonicalScoutMatchSuffix(matchKey);
  if (!wanted) return null;
  return (matches || []).find((match) => canonicalScoutMatchSuffix(match?.key) === wanted) || null;
}

/** 'red' or 'blue' for a team in a TBA match, or null when the schedule does not list it. */
export function allianceFor(match, teamKey) {
  const key = `frc${teamNumber(teamKey)}`;
  for (const color of ['red', 'blue']) {
    if ((match?.alliances?.[color]?.team_keys || []).includes(key)) return color;
  }
  return null;
}

const startMs = (match) => {
  const epoch = Number.isFinite(match?.predicted_time) ? match.predicted_time : match?.time;
  return Number.isFinite(epoch) ? epoch * 1000 : null;
};

const played = (match) =>
  Number.isFinite(match?.actual_time) ||
  (Number(match?.alliances?.red?.score) >= 0 &&
    Number(match?.alliances?.blue?.score) >= 0 &&
    match?.alliances?.red?.score != null &&
    match?.alliances?.blue?.score != null);

/** Where an assignment opens: Match Scouting on the scout's tab with the match, robot and alliance filled in. */
export function assignmentHref(row, alliance = null) {
  if (row?.scouting_type === 'note') return '/notescout';
  if (row?.scouting_type === 'quick') return '/quickscout';
  const params = new URLSearchParams();
  params.set('tab', row?.report_kind || 'data');
  const suffix = String(row?.match_key || '')
    .split('_')
    .pop();
  params.set('match', suffix.replace(/^qm/i, ''));
  params.set('team', teamNumber(row?.team_key));
  if (alliance) params.set('alliance', alliance);
  // The match key starts with its competition code, so a training assignment opens under the training code.
  const eventKey = String(row?.match_key || '').split('_')[0];
  if (eventKey && String(row?.match_key || '').includes('_')) params.set('event_key', eventKey);
  return `/matchscout?${params}`;
}

/**
 * Open assignments ready to show: completed ones dropped, each with its label, alliance, link and
 * whether its match has already been played (overdue), in the order the matches are played.
 */
export function openAssignments(rows, matches) {
  return (rows || [])
    .filter((row) => row && !row.completed_at)
    .map((row) => {
      const match = row.scouting_type === 'data' || !row.scouting_type ? scheduledMatch(row.match_key, matches) : null;
      const alliance = allianceFor(match, row.team_key);
      const startsAtMs = startMs(match);
      return {
        ...row,
        role: assignmentRoleLabel(row),
        matchLabel: matchLabel(row.match_key),
        team: teamNumber(row.team_key),
        alliance,
        startsAtMs,
        // Played and still open: the scout missed it (or has not submitted yet).
        overdue: match ? played(match) : false,
        href: assignmentHref(row, alliance)
      };
    })
    .sort((left, right) => {
      return compareMatchKeys(left.match_key, right.match_key) || Number(left.team) - Number(right.team);
    });
}

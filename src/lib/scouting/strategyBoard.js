// Strategy board: per-team numbers for the team list and the team brief, built from the rows
// buildStrategyRows already makes, the event's EPA model and TBA's rankings.

import { scoutedRobotMatches } from '../matches/epaModel.js';
import { reportKindOf } from './reportKinds.js';
import { compareTbaMatches, shortMatchLabel } from '../matches/matchKeys.js';

const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);

/** The numbers Strategy shows for one team. Missing is null ("not scouted"), never 0. */
const average = (values) => {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
};

/** What Performance scouts rated, from this team's Performance reports. */
export function performanceSummary(entries = []) {
  const reports = entries.filter((entry) => reportKindOf(entry) === 'performance' && entry.robot_present !== false);
  return {
    reports: reports.length,
    offense: average(reports.map((entry) => entry.offense_rating)),
    defense: average(reports.map((entry) => entry.defense_rating)),
    driver: average(reports.map((entry) => entry.driver_skill)),
    intake: average(reports.map((entry) => entry.intake_speed))
  };
}

/** What Robot scouts saw go wrong, from this team's Robot reports (matches, not reports, so two scouts count once). */
export function robotSummary(entries = []) {
  const reports = entries.filter((entry) => reportKindOf(entry) === 'robot');
  const matchesWhere = (test) => new Set(reports.filter(test).map((entry) => entry.match_key)).size;
  const matches = new Set(reports.map((entry) => entry.match_key)).size;
  const fouls = reports.reduce(
    (total, entry) => total + (Number(entry.fouls_minor) || 0) + (Number(entry.fouls_major) || 0),
    0
  );
  return {
    reports: reports.length,
    matches,
    breaks: matchesWhere((entry) => entry.mechanical_break === true),
    crashes: matchesWhere((entry) => entry.significant_crash === true),
    beached: matchesWhere((entry) => entry.beached === true),
    stopped: matchesWhere((entry) => ['dead', 'stopped', 'brownout'].includes(entry.teleop_robot_status)),
    jams: matchesWhere((entry) => entry.intake_jammed === true),
    noShows: matchesWhere((entry) => entry.robot_present === false),
    cards: matchesWhere((entry) => ['yellow', 'red'].includes(entry.card)),
    foulsPerMatch: reports.length ? fouls / reports.length : null
  };
}

export function teamStats(row, { epaRow = null, officialRow = null, epaRank = null, powerRank = null } = {}) {
  const summary = row?.matchScoutSummary || {};
  const entries = row?.matchEntries || [];
  const kinds = { data: 0, performance: 0, robot: 0 };
  for (const entry of entries) kinds[reportKindOf(entry)] += 1;
  return {
    epa: finiteOrNull(epaRow?.epa),
    epaRank,
    auto: finiteOrNull(epaRow?.components?.auto),
    teleop: finiteOrNull(epaRow?.components?.teleop),
    endgame: finiteOrNull(epaRow?.components?.endgame),
    rank: officialRow?.rank ?? null,
    record: officialRow ? `${officialRow.wins ?? 0}-${officialRow.losses ?? 0}-${officialRow.ties ?? 0}` : null,
    opr: finiteOrNull(officialRow?.epa ?? officialRow?.opr),
    fuel: finiteOrNull(summary.avgBallsScored),
    autoPoints: finiteOrNull(row?.autoAverage ?? summary.avgAutoPoints),
    accuracy: finiteOrNull(summary.ratingAverages?.['Shot accuracy']),
    bps: finiteOrNull(summary.ratingAverages?.BPS),
    driver: finiteOrNull(summary.avgDriverSkill),
    // Share of watched matches with a break, crash, beaching or no-show (EPA's measure, else the report summary's).
    incidentRate: finiteOrNull(epaRow?.incidentRate ?? summary.incidentRate),
    autoRunRate: finiteOrNull(summary.autoRunRate),
    roles: summary.roleCounts || {},
    matchesScouted: summary.matchesScouted || 0,
    kinds,
    // Performance scouts' power ranking: average place among the robots they ranked (1 = best).
    powerRank: finiteOrNull(powerRank?.average),
    powerRankMatches: powerRank?.matches || 0,
    performance: performanceSummary(entries),
    robot: robotSummary(entries),
    openIssues: row?.openProblems?.length || 0
  };
}

export const STRATEGY_SORTS = Object.freeze([
  ['epa', 'EPA'],
  ['rank', 'Event rank'],
  ['fuel', 'Scouted fuel'],
  ['autoPoints', 'Auto points'],
  ['accuracy', 'Shot accuracy'],
  ['bps', 'BPS'],
  ['reliability', 'Reliability'],
  ['reports', 'Reports'],
  ['team', 'Team number']
]);

// Value and direction per sort; teams with no value always sort last.
const SORT_VALUE = {
  epa: (item) => item.stats.epa,
  rank: (item) => item.stats.rank,
  fuel: (item) => item.stats.fuel,
  autoPoints: (item) => item.stats.autoPoints,
  accuracy: (item) => item.stats.accuracy,
  bps: (item) => item.stats.bps,
  reliability: (item) => item.stats.incidentRate,
  reports: (item) => item.stats.kinds.data + item.stats.kinds.performance + item.stats.kinds.robot,
  team: (item) => Number(item.row.teamNumber) || null
};
const ASCENDING = new Set(['rank', 'reliability', 'team']);

export function sortTeams(items, key = 'epa') {
  const valueOf = SORT_VALUE[key] || SORT_VALUE.epa;
  const ascending = ASCENDING.has(key);
  return [...items].sort((left, right) => {
    const a = valueOf(left);
    const b = valueOf(right);
    if (a == null && b == null) return Number(left.row.teamNumber) - Number(right.row.teamNumber);
    if (a == null) return 1;
    if (b == null) return -1;
    return ascending ? a - b : b - a;
  });
}

/**
 * One entry per match the team is scheduled in (TBA order): what our scouts saw (scouted points, an incident or a
 * no-show) and the official result.
 */
export function matchTimeline(teamKey, matches = [], entries = []) {
  const observations = new Map(
    (scoutedRobotMatches((entries || []).filter((entry) => entry?.team_key === teamKey)).get(teamKey) || []).map(
      (observation) => [observation.matchKey, observation]
    )
  );
  const noShows = new Set(
    (entries || [])
      .filter((entry) => entry?.team_key === teamKey && entry.robot_present === false)
      .map((entry) => entry.match_key)
  );
  return [...(matches || [])]
    .filter((match) => ['red', 'blue'].some((side) => (match?.alliances?.[side]?.team_keys || []).includes(teamKey)))
    .sort(compareTbaMatches)
    .map((match) => {
      const side = (match.alliances.red.team_keys || []).includes(teamKey) ? 'red' : 'blue';
      const other = side === 'red' ? 'blue' : 'red';
      const score = match.alliances[side]?.score;
      const opponentScore = match.alliances[other]?.score;
      const played = Number.isFinite(score) && Number.isFinite(opponentScore) && score >= 0 && opponentScore >= 0;
      const observation = observations.get(match.key);
      return {
        matchKey: match.key,
        label: shortMatchLabel(match.key),
        side,
        played,
        score: played ? score : null,
        opponentScore: played ? opponentScore : null,
        result: !played ? null : score > opponentScore ? 'win' : score < opponentScore ? 'loss' : 'tie',
        points: observation?.points ?? null,
        incident: observation?.incident === true,
        noShow: noShows.has(match.key)
      };
    });
}

import { compareTbaMatches } from '../matches/matchKeys.js';
import { isMatchPlayed } from '../matches/matchProjection.js';

export const timeFor = (match) => {
  for (const value of [match?.predicted_time, match?.time, match?.actual_time]) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
};

// Start time when both matches have one; otherwise play order (level, set, match), so an untimed playoff never sorts
// in among the quals by its match number.
export const matchOrder = (left, right) => {
  const leftTime = timeFor(left);
  const rightTime = timeFor(right);
  if (leftTime != null && rightTime != null && leftTime !== rightTime) return leftTime - rightTime;
  return compareTbaMatches(left, right);
};

export function teamAlliance(match, teamKey) {
  if ((match?.alliances?.red?.team_keys || []).includes(teamKey)) return 'red';
  if ((match?.alliances?.blue?.team_keys || []).includes(teamKey)) return 'blue';
  return null;
}

/**
 * Our team's schedule, with the soonest upcoming match first (direct instruction
 * - it previously rendered latest-first, then that was reversed). Synthetic
 * practice matches remain available for testing without affecting real
 * match urgency.
 */
export function buildStrategySchedule(matches = [], teamKey) {
  const ours = matches.filter((match) => teamAlliance(match, teamKey));
  const realUpcoming = ours.filter((match) => !isMatchPlayed(match) && !match.is_test_market).sort(matchOrder);
  const upcomingByMatch = new Map(
    realUpcoming.map((match, matchesAway) => [
      match.key,
      {
        match,
        alliance: teamAlliance(match, teamKey),
        matchesAway,
        estimatedTime: timeFor(match)
      }
    ])
  );
  const practice = ours
    .filter((match) => !isMatchPlayed(match) && match.is_test_market)
    .map((match) => ({
      match,
      alliance: teamAlliance(match, teamKey),
      matchesAway: null,
      estimatedTime: null
    }));
  const upcoming = [...upcomingByMatch.values()].sort((left, right) => matchOrder(left.match, right.match));
  const played = ours
    .filter(isMatchPlayed)
    .sort((left, right) => matchOrder(right, left))
    .map((match) => ({
      match,
      alliance: teamAlliance(match, teamKey),
      matchesAway: null,
      estimatedTime: timeFor(match)
    }));
  return { upcoming: [...upcoming, ...practice], played, realUpcoming };
}

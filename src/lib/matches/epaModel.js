// EPA (Expected Points Added): each team's expected contribution to its
// alliance's score, in points, so an alliance's prediction is the sum of
// its three robots.
//
// V2 (#171) fits every played match at once instead of nudging ratings one
// match at a time, and anchors each team to what our own scouts saw:
//
//   minimise  sum over alliances (score - sum of its 3 ratings)^2
//           + sum over teams     weight_t * (rating_t - prior_t)^2
//
// That is ridge-regularised OPR. The prior is the team's scouting estimate
// (Data reports: balls scored plus auto points, averaged per match across
// scouts, shrunk toward the event average, discounted by how often Robot
// reports saw the robot break), converted to points by a line fitted on
// the alliances played so far. A team nobody scouted is pulled, more
// gently, toward the event's average robot instead. Early in an event the
// prior carries the rating; as matches pile up the scores take over.
//
// Back-tested walk-forward (every match predicted only from earlier matches
// and earlier scouting), parameters picked on one event and scored on the
// other (details in docs/analysis/epa.md):
//   2026cacg  Brier 0.172 -> 0.140, score error 79.7 -> 65.7
//   2026cc    Brier 0.194 -> 0.176, score error 125.6 -> 112.4
// All three report kinds feed the estimate: Data reports give the points,
// Performance reports (shot accuracy x BPS) fill in robot-matches no Data
// scout covered and nudge each team by how it rates against the event, and
// Robot reports discount robots that keep breaking. Power rankings stay a
// separate consensus signal (Power Rankings page).

const ALLIANCE_SIZE = 3;
// Ridge weight of a scouted team's prior, in "alliance observations": 1.6
// means the scouting counts for about one and a half played matches.
const SCOUTED_PRIOR_WEIGHT = 1.6;
// A team with no scouting is pulled toward the average robot much more
// gently - just enough to keep the fit stable before it has played.
const BASELINE_PRIOR_WEIGHT = 0.1;
// A team's scouted average is shrunk toward the event average as if it had
// this many extra matches at the average.
const SCOUT_SHRINK_MATCHES = 1;
// Robot incidents (breaks, crashes, beached, not active): a robot that
// breaks in every match is expected to score this much less.
const INCIDENT_IMPACT = 0.4;
const INCIDENT_PRIOR_MATCHES = 4;
const INCIDENT_PRIOR_RATE = 0.1;
// Alliances (all three robots scouted) needed before the scouting -> points
// line is fitted rather than assumed (slope 1, offset from the average gap).
const MIN_CALIBRATION_ALLIANCES = 10;
// Performance ratings: robot-matches with both a Data and a Performance
// report needed before accuracy x BPS is turned into points for the ones
// that only have a Performance report.
const MIN_PERFORMANCE_PAIRS = 10;
// How strongly a team's average accuracy x BPS (relative to the event's)
// scales its scouted points: 0.2 means a team rated twice the event average
// is expected to score 20% more than its Data reports alone say.
const PERFORMANCE_WEIGHT = 0.2;
const BETA_RANGE = [0.3, 2];
// Scout rankings: the scouting group's best-to-worst order of all six robots each match, and each Performance
// scout's power ranking of the robots they watched. A team ranked first everywhere gets RANK_WEIGHT more points
// than one ranked mid-pack (scaled by how many rankings there are).
const RANK_WEIGHT = 0.2;
// Defense: a robot that plays defense (Data report role) takes this share of an average robot's points off the
// alliance it plays against, scaled by its Performance defense rating (3 of 5 = 1x).
const DEFENSE_WEIGHT = 0.25;

// Every weight above, overridable through options.tuning so the back-test can compare settings.
const DEFAULT_TUNING = Object.freeze({
  scoutedPriorWeight: SCOUTED_PRIOR_WEIGHT,
  baselinePriorWeight: BASELINE_PRIOR_WEIGHT,
  shrinkMatches: SCOUT_SHRINK_MATCHES,
  incidentImpact: INCIDENT_IMPACT,
  performanceWeight: PERFORMANCE_WEIGHT,
  rankWeight: RANK_WEIGHT,
  rankOnlyEstimates: false,
  defenseWeight: DEFENSE_WEIGHT
});
const tuningFrom = (options = {}) => ({ ...DEFAULT_TUNING, ...(options.tuning || {}) });

function chronologicalKey(match) {
  // Chronological where TBA has posted real times; otherwise fall back to
  // comp level then match number, which is at least the right order within
  // one level even before an event has real match times.
  const time = Number(match?.actual_time || match?.predicted_time || match?.time || 0);
  if (time > 0) return time;
  const levelOrder = { pm: -1, qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
  const level = levelOrder[String(match?.comp_level || '').toLowerCase()] ?? 99;
  return level * 1000 + (Number(match?.match_number) || 0);
}

function isPlayed(match) {
  const redScore = match?.alliances?.red?.score;
  const blueScore = match?.alliances?.blue?.score;
  return Number.isFinite(redScore) && Number.isFinite(blueScore) && redScore >= 0 && blueScore >= 0;
}

function playedMatchesInOrder(matches) {
  return (matches || [])
    .filter(isPlayed)
    .slice()
    .sort((a, b) => chronologicalKey(a) - chronologicalKey(b));
}

const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

// Score components from TBA's score_breakdown, when the game has one.
// Fouls are left out of all three (they are the opponents' doing).
function breakdownComponents(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const auto = finite(breakdown.totalAutoPoints ?? breakdown.autoPoints);
  const teleop = finite(breakdown.totalTeleopPoints ?? breakdown.teleopPoints);
  const endgame = finite(breakdown.endGameTowerPoints ?? breakdown.endGamePoints ?? breakdown.endgamePoints);
  if (auto === null && teleop === null && endgame === null) return null;
  return { auto, teleop, endgame };
}

function alliancesOf(match) {
  return ['red', 'blue'].map((side) => ({
    side,
    teams: match.alliances?.[side]?.team_keys || [],
    score: Number(match.alliances[side].score),
    components: breakdownComponents(match.score_breakdown?.[side])
  }));
}

const isDataReport = (entry) => !entry?.report_kind || entry.report_kind === 'data';
const hasRobotStatus = (entry) => entry?.report_kind === 'robot' || entry?.teleop_robot_status != null;
const performanceRating = (entry) => {
  const accuracy = finite(entry?.ratings?.['Shot accuracy']);
  const bps = finite(entry?.ratings?.BPS);
  return accuracy === null || bps === null ? null : accuracy * bps;
};
// "Did the robot show up?" answered No (or, before that column existed, the note the server writes instead).
const isNoShow = (entry) =>
  entry?.robot_present === false || /^Robot did not show up\./.test(String(entry?.post_notes || ''));
const isIncident = (entry) =>
  Boolean(entry.mechanical_break || entry.significant_crash || entry.beached) ||
  (entry.teleop_robot_status != null && entry.teleop_robot_status !== 'active');

/**
 * Collapses match scouting reports to one observation per robot per match:
 * the Data reports' balls scored and auto points averaged across scouts
 * (missing is "not scouted", never 0), and whether any report saw an
 * incident (a robot that did not show up is 0 points and an incident), plus the Performance rating (shot accuracy x BPS, 1-25)
 * averaged across the reports that have one.
 *
 * @returns {Map<string, Array<{ matchKey: string, points: number|null, auto: number|null, balls: number|null, performance: number|null, incident: boolean|null }>>}
 */
export function scoutedRobotMatches(entries = []) {
  const byRobotMatch = new Map();
  for (const entry of entries || []) {
    if (!entry?.match_key || !entry?.team_key) continue;
    const key = `${entry.match_key}|${entry.team_key}`;
    if (!byRobotMatch.has(key)) byRobotMatch.set(key, []);
    byRobotMatch.get(key).push(entry);
  }
  const byTeam = new Map();
  for (const reports of byRobotMatch.values()) {
    const { match_key: matchKey, team_key: teamKey } = reports[0];
    const data = reports.filter(isDataReport);
    const balls = mean(data.map((entry) => finite(entry.balls_scored_average)).filter((value) => value !== null));
    const auto = mean(data.map((entry) => finite(entry.auto_points_average)).filter((value) => value !== null));
    const robot = reports.filter(hasRobotStatus);
    const performance = mean(reports.map(performanceRating).filter((value) => value !== null));
    const defended = data.some((entry) =>
      (entry.teleop_roles || []).some((role) => String(role).toLowerCase() === 'defense')
    );
    const defenseRating = mean(
      reports.map((entry) => finite(entry.defense_rating)).filter((value) => value !== null && value > 0)
    );
    // Any scout saying the robot never came out makes that match 0 points and an incident, whatever else was filed.
    const noShow = reports.some(isNoShow);
    const observation = noShow
      ? {
          matchKey,
          balls: 0,
          auto: 0,
          points: 0,
          performance: null,
          incident: true,
          defended: false,
          defenseRating: null
        }
      : {
          matchKey,
          balls,
          auto,
          points: balls === null ? null : balls + (auto ?? 0),
          performance,
          incident: robot.length ? robot.some(isIncident) : null,
          defended,
          defenseRating
        };
    if (observation.points === null && observation.incident === null && observation.performance === null) continue;
    if (!byTeam.has(teamKey)) byTeam.set(teamKey, []);
    byTeam.get(teamKey).push(observation);
  }
  return byTeam;
}

/**
 * Per-team scouting estimate in scouted points (not yet calibrated to the
 * real score), from the observations whose match is in `matchKeys`.
 */
export function scoutingEstimates(robotMatches, matchKeys = null, tuning = DEFAULT_TUNING, rankEvents = []) {
  const t = { ...DEFAULT_TUNING, ...tuning };
  const allowed = (observation) => !matchKeys || matchKeys.has(observation.matchKey);
  const everyPoint = [];
  const everyAuto = [];
  for (const observations of robotMatches.values()) {
    for (const observation of observations) {
      if (!allowed(observation)) continue;
      if (observation.points !== null) everyPoint.push(observation.points);
      if (observation.auto !== null) everyAuto.push(observation.auto);
    }
  }
  const eventPoints = mean(everyPoint);
  const eventAuto = mean(everyAuto);
  const toPoints = performanceToPoints(robotMatches, allowed);
  const everyPerformance = [];
  for (const observations of robotMatches.values())
    for (const observation of observations)
      if (allowed(observation) && observation.performance !== null) everyPerformance.push(observation.performance);
  const eventPerformance = mean(everyPerformance);
  const ranks = rankScores(rankEvents, matchKeys);
  const eventRank = mean([...ranks.values()].map((rank) => rank.score));
  const estimates = new Map();
  for (const teamKey of new Set([...robotMatches.keys(), ...ranks.keys()])) {
    const observations = robotMatches.get(teamKey) || [];
    const seen = observations.filter(allowed);
    // A robot-match with no Data report but a Performance rating still counts, its points read off the
    // accuracy x BPS line.
    const points = seen
      .map((observation) =>
        observation.points !== null
          ? observation.points
          : toPoints && observation.performance !== null
            ? toPoints(observation.performance)
            : null
      )
      .filter((value) => value !== null);
    const ratings = seen.map((observation) => observation.performance).filter((value) => value !== null);
    const autos = seen.map((observation) => observation.auto).filter((value) => value !== null);
    const incidents = seen.filter((observation) => observation.incident !== null);
    const incidentCount = incidents.filter((observation) => observation.incident).length;
    const incidentRate =
      (incidentCount + INCIDENT_PRIOR_RATE * INCIDENT_PRIOR_MATCHES) / (incidents.length + INCIDENT_PRIOR_MATCHES);
    const rank = ranks.get(teamKey) || null;
    const rankFactor =
      rank && eventRank && t.rankWeight
        ? 1 + (t.rankWeight * (rank.score / eventRank - 1) * rank.count) / (rank.count + 1)
        : 1;
    // Defense: the share of watched matches this robot defended, scaled by its defense rating (3 of 5 = 1x).
    const defenseMatches = seen.filter((observation) => observation.points !== null || observation.defended);
    const defenseRatings = seen.map((observation) => observation.defenseRating).filter((value) => value !== null);
    const defense = defenseMatches.length
      ? (defenseMatches.filter((observation) => observation.defended).length / (defenseMatches.length + 1)) *
        ((mean(defenseRatings) ?? 3) / 3)
      : 0;
    // A team only the scouts' rankings cover still gets an estimate: the event average, scaled by its rank.
    if (!points.length && rank && t.rankWeight && t.rankOnlyEstimates && eventPoints !== null) {
      estimates.set(teamKey, {
        points: eventPoints * rankFactor,
        auto: null,
        matches: 0,
        rank: rank.score,
        rankings: rank.count,
        defense,
        incidentRate: null,
        incidentReports: 0
      });
      continue;
    }
    if (!points.length) {
      if (incidents.length)
        estimates.set(teamKey, {
          points: null,
          auto: null,
          matches: 0,
          incidentRate,
          incidentReports: incidents.length,
          defense
        });
      continue;
    }
    const shrunk =
      (points.reduce((sum, value) => sum + value, 0) + t.shrinkMatches * eventPoints) /
      (points.length + t.shrinkMatches);
    const autoShrunk =
      autos.length && eventAuto !== null
        ? (autos.reduce((sum, value) => sum + value, 0) + SCOUT_SHRINK_MATCHES * eventAuto) /
          (autos.length + SCOUT_SHRINK_MATCHES)
        : null;
    const reliability = incidents.length ? 1 - t.incidentImpact * incidentRate : 1;
    const performanceFactor =
      ratings.length && eventPerformance
        ? 1 + (t.performanceWeight * (mean(ratings) / eventPerformance - 1) * ratings.length) / (ratings.length + 1)
        : 1;
    estimates.set(teamKey, {
      points: shrunk * reliability * performanceFactor * rankFactor,
      rank: rank?.score ?? null,
      rankings: rank?.count || 0,
      defense,
      performance: ratings.length ? mean(ratings) : null,
      performanceReports: ratings.length,
      auto: autoShrunk,
      matches: points.length,
      incidentRate: incidents.length ? incidentRate : null,
      incidentReports: incidents.length
    });
  }
  return estimates;
}

/**
 * Every ranking our scouts made, as { matchKey, order: [team keys best first] }: the scouting group's ranking of the
 * whole match (scouting_match_rankings) and each Performance scout's power ranking (one per scout per match).
 */
export function scoutRankEvents(entries = [], matchRankings = []) {
  const events = [];
  for (const row of matchRankings || []) {
    const order = (row?.ranked_team_keys || []).filter(Boolean);
    if (row?.match_key && order.length >= 2) events.push({ matchKey: row.match_key, order });
  }
  const seen = new Set();
  for (const entry of entries || []) {
    const ranking = entry?.power_ranking;
    if (!entry?.match_key || !ranking || typeof ranking !== 'object') continue;
    const scout = entry.created_by || entry.scout_name || entry.id;
    const key = `${entry.match_key}|${scout}`;
    if (seen.has(key)) continue;
    const order = Object.entries(ranking)
      .filter(([, place]) => Number.isFinite(Number(place)))
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map(([team]) => team);
    if (order.length < 2) continue;
    seen.add(key);
    events.push({ matchKey: entry.match_key, order });
  }
  return events;
}

// Per team: average place score across rankings (1 = ranked first, 0 = ranked last) and how many rankings.
function rankScores(rankEvents, matchKeys) {
  const totals = new Map();
  for (const { matchKey, order } of rankEvents || []) {
    if (matchKeys && !matchKeys.has(matchKey)) continue;
    order.forEach((team, place) => {
      const total = totals.get(team) || { sum: 0, count: 0 };
      total.sum += 1 - place / (order.length - 1);
      total.count += 1;
      totals.set(team, total);
    });
  }
  return new Map([...totals].map(([team, { sum, count }]) => [team, { score: sum / count, count }]));
}

/** Everything the model reads from scouting, prepared once per call. */
function prepareScouting(options = {}) {
  return {
    robotMatches: scoutedRobotMatches(options.scoutEntries),
    rankEvents: scoutRankEvents(options.scoutEntries, options.matchRankings)
  };
}

// Line from a robot-match's Performance rating to its Data-scouted points,
// fitted on the robot-matches that have both. Null until there are enough.
function performanceToPoints(robotMatches, allowed) {
  const pairs = [];
  for (const observations of robotMatches.values())
    for (const observation of observations)
      if (allowed(observation) && observation.points !== null && observation.performance !== null)
        pairs.push([observation.performance, observation.points]);
  if (pairs.length < MIN_PERFORMANCE_PAIRS) return null;
  const mx = mean(pairs.map(([x]) => x));
  const my = mean(pairs.map(([, y]) => y));
  let covariance = 0;
  let variance = 0;
  for (const [x, y] of pairs) {
    covariance += (x - mx) * (y - my);
    variance += (x - mx) ** 2;
  }
  if (!(variance > 0) || !(covariance > 0)) return null;
  const slope = covariance / variance;
  return (rating) => Math.max(0, my + slope * (rating - mx));
}

// Least-squares line from an alliance's summed scouting estimate to its
// real score. Scouts undercount by a roughly constant amount (balls they
// missed, human-player shots), which the offset absorbs.
function calibrate(alliances, estimateOf, valueOf) {
  const rows = [];
  for (const alliance of alliances) {
    const value = valueOf(alliance);
    if (value === null) continue;
    const estimates = alliance.teams.map(estimateOf);
    if (estimates.length !== ALLIANCE_SIZE || estimates.some((estimate) => estimate === null)) continue;
    rows.push([estimates.reduce((sum, estimate) => sum + estimate, 0), value]);
  }
  if (!rows.length) return { alpha: 0, beta: 1, samples: 0, fitted: false };
  if (rows.length < MIN_CALIBRATION_ALLIANCES)
    return { alpha: mean(rows.map(([x, y]) => y - x)), beta: 1, samples: rows.length, fitted: false };
  const mx = mean(rows.map(([x]) => x));
  const my = mean(rows.map(([, y]) => y));
  let covariance = 0;
  let variance = 0;
  for (const [x, y] of rows) {
    covariance += (x - mx) * (y - my);
    variance += (x - mx) ** 2;
  }
  const beta = Math.min(BETA_RANGE[1], Math.max(BETA_RANGE[0], variance > 0 ? covariance / variance : 1));
  return { alpha: my - beta * mx, beta, samples: rows.length, fitted: true };
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const lead = rows[column][column];
    if (Math.abs(lead) < 1e-12) continue;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column] / lead;
      if (factor === 0) continue;
      for (let k = column; k <= n; k += 1) rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map((row, index) => (Math.abs(row[index]) < 1e-12 ? 0 : row[n] / row[index]));
}

// Ridge fit: observations are { teams, value } (an alliance's points),
// priors map each team to { mean, weight }.
function ridgeRatings(observations, priors) {
  const teams = [...priors.keys()];
  const index = new Map(teams.map((team, position) => [team, position]));
  const n = teams.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  const vector = new Array(n).fill(0);
  for (const { teams: members, value } of observations) {
    for (const team of members) {
      const row = index.get(team);
      vector[row] += value;
      for (const other of members) matrix[row][index.get(other)] += 1;
    }
  }
  teams.forEach((team, position) => {
    const { mean: priorMean, weight } = priors.get(team);
    matrix[position][position] += weight;
    vector[position] += weight * priorMean;
  });
  const solution = n ? solveLinearSystem(matrix, vector) : [];
  return new Map(teams.map((team, position) => [team, solution[position]]));
}

/**
 * Fits ratings from `played` matches (chronological) and the scouting seen
 * for those matches. Shared by computeEventEpa (all played matches) and the
 * walk-forward back-test (only the matches before the one predicted).
 */
function fitRatings(played, scouting, extraTeams = [], options = {}) {
  const t = tuningFrom(options);
  const alliances = played.flatMap(alliancesOf);
  const matchKeys = new Set(played.map((match) => match.key).filter(Boolean));
  const useScouting =
    (scouting.robotMatches.size > 0 || scouting.rankEvents.length > 0) && options.useScouting !== false;
  const estimates = useScouting
    ? scoutingEstimates(scouting.robotMatches, matchKeys, t, scouting.rankEvents)
    : new Map();
  const scoreSum = alliances.reduce((sum, alliance) => sum + alliance.score, 0);
  const baseline = options.initialEpa ?? (alliances.length ? scoreSum / alliances.length / ALLIANCE_SIZE : 0);
  const pointsOf = (team) => estimates.get(team)?.points ?? null;
  const calibration = calibrate(alliances, pointsOf, (alliance) => alliance.score);
  const priorFor = (team) => {
    const points = pointsOf(team);
    return points === null
      ? { mean: baseline, weight: t.baselinePriorWeight, source: 'baseline' }
      : {
          mean: calibration.alpha / ALLIANCE_SIZE + calibration.beta * points,
          weight: t.scoutedPriorWeight,
          source: 'scouting'
        };
  };
  // Points an alliance lost to the other alliance's defenders: added back before fitting, so ratings stay what a
  // robot scores undefended, and taken off again when predicting.
  const defenseAgainst = (opponents) =>
    t.defenseWeight
      ? t.defenseWeight * baseline * opponents.reduce((sum, team) => sum + (estimates.get(team)?.defense || 0), 0)
      : 0;
  const teams = new Set([...alliances.flatMap((alliance) => alliance.teams), ...extraTeams]);
  const priors = new Map([...teams].map((team) => [team, priorFor(team)]));
  const observations = played.flatMap((match) => {
    const [red, blue] = alliancesOf(match);
    return [
      { teams: red.teams, value: red.score + defenseAgainst(blue.teams) },
      { teams: blue.teams, value: blue.score + defenseAgainst(red.teams) }
    ];
  });
  const ratings = ridgeRatings(observations, priors);
  const predict = (own, opponents) =>
    own.reduce((sum, team) => sum + (ratings.get(team) ?? baseline), 0) - defenseAgainst(opponents);
  return { alliances, estimates, baseline, calibration, priors, ratings, predict };
}

// Auto / teleop / endgame ratings from TBA's score breakdown, each fitted
// the same way. Auto is anchored to scouted auto points; teleop and endgame
// to the event average (scouted balls are already in the total).
function componentRatings(alliances, estimates, teams) {
  const withBreakdown = alliances.filter((alliance) => alliance.components);
  if (!withBreakdown.length) return null;
  const result = {};
  for (const component of ['auto', 'teleop', 'endgame']) {
    const observations = withBreakdown
      .filter((alliance) => alliance.components[component] !== null)
      .map((alliance) => ({ teams: alliance.teams, value: alliance.components[component] }));
    if (!observations.length) continue;
    const average = mean(observations.map((observation) => observation.value)) / ALLIANCE_SIZE;
    const autoOf = (team) => (component === 'auto' ? (estimates.get(team)?.auto ?? null) : null);
    const calibration =
      component === 'auto'
        ? calibrate(withBreakdown, autoOf, (alliance) => alliance.components.auto)
        : { alpha: 0, beta: 1 };
    const priors = new Map(
      [...teams].map((team) => {
        const scouted = autoOf(team);
        return [
          team,
          scouted === null
            ? { mean: average, weight: BASELINE_PRIOR_WEIGHT }
            : { mean: calibration.alpha / ALLIANCE_SIZE + calibration.beta * scouted, weight: SCOUTED_PRIOR_WEIGHT }
        ];
      })
    );
    result[component] = ridgeRatings(observations, priors);
  }
  return result;
}

/**
 * Computes an EPA rating per team from TBA-shaped matches
 * (alliances.red/blue.team_keys + .score, optional score_breakdown), plus
 * our match scouting reports when given.
 *
 * @param {Array} matches
 * @param {{ scoutEntries?: Array, initialEpa?: number, useScouting?: boolean }} [options]
 * @returns {Map<string, { epa: number, prior: number, priorSource: 'scouting'|'baseline', scoutedMatches: number,
 *   incidentRate: number|null, components: { auto?: number, teleop?: number, endgame?: number } | null,
 *   matchesPlayed: number, wins: number, losses: number, ties: number, totalScore: number, avgScore: number }>}
 *   The Map also carries residualStd (points; from the walk-forward back-test once there is enough history,
 *   so it reflects real prediction error rather than the in-sample fit) and calibration.
 */
export function computeEventEpa(matches, options = {}) {
  const played = playedMatchesInOrder(matches);
  const scouting = prepareScouting(options);
  const fit = fitRatings(played, scouting, [], options);
  const components = componentRatings(fit.alliances, fit.estimates, [...fit.ratings.keys()]);

  const stats = new Map();
  for (const match of played) {
    const [red, blue] = alliancesOf(match);
    for (const [own, other] of [
      [red, blue],
      [blue, red]
    ]) {
      for (const team of own.teams) {
        if (!stats.has(team)) stats.set(team, { matchesPlayed: 0, wins: 0, losses: 0, ties: 0, totalScore: 0 });
        const row = stats.get(team);
        row.matchesPlayed += 1;
        row.totalScore += own.score;
        if (own.score > other.score) row.wins += 1;
        else if (own.score < other.score) row.losses += 1;
        else row.ties += 1;
      }
    }
  }

  const result = new Map();
  for (const [teamKey, epa] of fit.ratings) {
    const row = stats.get(teamKey) || { matchesPlayed: 0, wins: 0, losses: 0, ties: 0, totalScore: 0 };
    const prior = fit.priors.get(teamKey);
    const estimate = fit.estimates.get(teamKey);
    result.set(teamKey, {
      epa,
      prior: prior.mean,
      priorSource: prior.source,
      scoutedMatches: estimate?.matches || 0,
      // Points this robot's defense takes off the alliance it plays against (see predictAllianceScore).
      defensePoints: tuningFrom(options).defenseWeight * fit.baseline * (estimate?.defense || 0),
      rank: estimate?.rank ?? null,
      rankings: estimate?.rankings || 0,
      incidentRate: estimate?.incidentRate ?? null,
      components: components
        ? Object.fromEntries(Object.entries(components).map(([name, ratings]) => [name, ratings.get(teamKey)]))
        : null,
      ...row,
      avgScore: row.matchesPlayed ? row.totalScore / row.matchesPlayed : 0
    });
  }

  // A Map stays the interface every caller already depends on; these ride
  // along as properties rather than changing the return shape.
  let inSampleSq = 0;
  for (const alliance of fit.alliances) {
    const predicted = alliance.teams.reduce((sum, team) => sum + (fit.ratings.get(team) ?? fit.baseline), 0);
    inSampleSq += (alliance.score - predicted) ** 2;
  }
  const walkForward = played.length ? walkForwardPredictions(played, scouting, options) : [];
  const residuals = walkForward.flatMap((prediction) => [
    prediction.redScore - prediction.predictedRed,
    prediction.blueScore - prediction.predictedBlue
  ]);
  result.residualStd =
    residuals.length >= 2 * MIN_FIT_SAMPLES
      ? Math.sqrt(mean(residuals.map((value) => value * value)))
      : fit.alliances.length
        ? Math.sqrt(inSampleSq / fit.alliances.length)
        : 0;
  result.calibration = fit.calibration;
  result.scoutedTeams = [...fit.priors.values()].filter((prior) => prior.source === 'scouting').length;
  return result;
}

// Matches scored before the model has seen enough of the event to say
// anything: every team still sits on its prior, and including them just
// dilutes the score equally for every candidate.
const DEFAULT_WARMUP_MATCHES = 8;
// Below this many SCORED matches, a fitted parameter is fitting noise -
// the honest answer is "not enough history yet, use the defaults".
const MIN_FIT_SAMPLES = 12;

// Every played match predicted from strictly earlier matches and the
// scouting filed for them, in chronological order.
function walkForwardPredictions(played, scouting, options = {}) {
  const predictions = [];
  for (let index = 0; index < played.length; index += 1) {
    const match = played[index];
    const [red, blue] = alliancesOf(match);
    if (index === 0) {
      predictions.push({ index, predictedRed: 0, predictedBlue: 0, redScore: red.score, blueScore: blue.score });
      continue;
    }
    const fit = fitRatings(played.slice(0, index), scouting, [...red.teams, ...blue.teams], options);
    predictions.push({
      index,
      predictedRed: fit.predict(red.teams, blue.teams),
      predictedBlue: fit.predict(blue.teams, red.teams),
      redScore: red.score,
      blueScore: blue.score
    });
  }
  return predictions;
}

function scorePredictions(predictions, scale, warmup) {
  let samples = 0;
  let brierSum = 0;
  let brierSquareSum = 0;
  let logLossSum = 0;
  let correct = 0;
  let absoluteError = 0;
  let squaredError = 0;
  for (const prediction of predictions) {
    if (prediction.index < warmup) continue;
    const pRed = winProbability(prediction.predictedRed, prediction.predictedBlue, scale);
    const outcome =
      prediction.redScore > prediction.blueScore ? 1 : prediction.redScore < prediction.blueScore ? 0 : 0.5;
    const error = (pRed - outcome) ** 2;
    brierSum += error;
    brierSquareSum += error ** 2;
    logLossSum -= outcome * Math.log(pRed) + (1 - outcome) * Math.log(1 - pRed);
    if (outcome === 0.5) correct += 0.5;
    else if (pRed > 0.5 === (outcome === 1)) correct += 1;
    for (const residual of [
      prediction.redScore - prediction.predictedRed,
      prediction.blueScore - prediction.predictedBlue
    ]) {
      absoluteError += Math.abs(residual);
      squaredError += residual ** 2;
    }
    samples += 1;
  }
  const brier = samples ? brierSum / samples : NaN;
  // Standard error of that mean, so a caller can tell a real improvement
  // from noise. An event is a few dozen matches, not a few thousand.
  const brierVariance =
    samples > 1 ? Math.max(0, brierSquareSum / samples - brier ** 2) * (samples / (samples - 1)) : NaN;
  return {
    samples,
    brier,
    brierStdErr: samples > 1 ? Math.sqrt(brierVariance / samples) : NaN,
    logLoss: samples ? logLossSum / samples : NaN,
    accuracy: samples ? correct / samples : NaN,
    scoreMae: samples ? absoluteError / (2 * samples) : NaN,
    residualStd: samples ? Math.sqrt(squaredError / (2 * samples)) : NaN
  };
}

/**
 * Walk-forward (prequential) evaluation against matches that have already
 * happened: each match is predicted using ONLY earlier matches and the
 * scouting filed for them, then scored. Fitting the whole event and then
 * scoring it would let a match predict itself.
 *
 * @param {Array} matches
 * @param {{ scoutEntries?: Array, useScouting?: boolean, scale?: number, warmupMatches?: number }} [options]
 * @returns {{ samples: number, brier: number, brierStdErr: number, logLoss: number, accuracy: number, scoreMae: number, residualStd: number }}
 *   brier and logLoss are lower-is-better; accuracy is 0-1. A coin flip
 *   scores brier 0.25; anything above that is worse than guessing.
 */
export function evaluateEpaModel(matches, options = {}) {
  const played = playedMatchesInOrder(matches);
  const predictions = walkForwardPredictions(played, prepareScouting(options), options);
  return scorePredictions(
    predictions,
    options.scale ?? FALLBACK_SCALE,
    options.warmupMatches ?? DEFAULT_WARMUP_MATCHES
  );
}

const SCALE_GRID = [15, 25, 35, 50, 70, 100, 140, 180, 220, 280, 350];

/**
 * Picks the win-probability scale that would have predicted THIS event's
 * already-played matches best (walk-forward, so no lookahead). The ratings
 * themselves have no tuned learning rate any more; the scale is the one
 * knob left. Falls back (tuned: false) until there is enough history.
 */
export function fitEpaParameters(matches, options = {}) {
  const warmup = options.warmupMatches ?? DEFAULT_WARMUP_MATCHES;
  const played = playedMatchesInOrder(matches);
  const predictions = walkForwardPredictions(played, prepareScouting(options), options);
  const probe = scorePredictions(predictions, FALLBACK_SCALE, warmup);
  const preferredScale = Number.isFinite(probe.residualStd) ? calibratedScale(probe.residualStd) : FALLBACK_SCALE;
  const fallback = { scale: preferredScale, tuned: false, samples: probe.samples, brier: NaN };
  if (!(probe.samples >= MIN_FIT_SAMPLES)) return fallback;

  const grid = options.scaleGrid ?? [...new Set([...SCALE_GRID, Math.round(preferredScale)])].sort((a, b) => a - b);
  const scored = grid
    .map((scale) => ({ scale, ...scorePredictions(predictions, scale, warmup) }))
    .filter((candidate) => Number.isFinite(candidate.brier));
  if (!scored.length) return fallback;
  const best = scored.reduce((left, right) => (right.brier < left.brier ? right : left));
  // Shrink toward the scale this event's own prediction error implies: the
  // Brier curve over scale is shallow near its minimum, so take the
  // candidate closest to that prior among those within a quarter standard
  // error of the best. Distance is in log space (halving = doubling).
  const tolerance = Number.isFinite(best.brierStdErr) ? 0.25 * best.brierStdErr : 0;
  const tied = scored.filter((candidate) => candidate.brier <= best.brier + tolerance);
  tied.sort(
    (left, right) =>
      Math.abs(Math.log(left.scale / preferredScale)) - Math.abs(Math.log(right.scale / preferredScale)) ||
      left.brier - right.brier
  );
  const chosen = tied[0] || best;
  return { ...chosen, tuned: true, bestBrier: best.brier, tiedCandidates: tied.length };
}

// Win probability for team A's alliance vs team B's alliance, from each
// side's TOTAL EPA (the sum of 3 robots' ratings), using a logistic curve
// the same shape Statbotics/Elo systems use. `scale` controls how quickly a
// rating gap turns into near-certainty; callers pass a scale fitted to the
// event (fitEpaParameters) or derived from its scoring noise
// (calibratedScale), and 35 is only the fallback for alliance-level gaps.
//
// The result is clamped to 5%-95%: a good alliance still loses sometimes,
// and showing literally 0% or 100% reads as the model being broken even
// when the direction is right.
/**
 * An alliance's predicted score from computeEventEpa's ratings: its robots' EPA, less what the other alliance's
 * defenders take off. Teams without a rating count as `fallback` (0 by default).
 */
export function predictAllianceScore(epaByTeam, teamKeys = [], opponentKeys = [], fallback = 0) {
  const own = teamKeys.reduce((sum, key) => sum + (epaByTeam?.get(key)?.epa ?? fallback), 0);
  const defense = opponentKeys.reduce((sum, key) => sum + (epaByTeam?.get(key)?.defensePoints || 0), 0);
  return own - defense;
}

export function winProbability(epaA, epaB, scale = 35) {
  const diff = (epaA - epaB) / scale;
  const raw = 1 / (1 + Math.exp(-diff));
  return Math.min(0.95, Math.max(0.05, raw));
}

const MIN_SCALE = 12; // floor so a small early-event sample (near-zero residuals) can't collapse the curve back to a lock
const FALLBACK_SCALE = 35; // used until an event has enough played matches to measure its own scoring variance

/**
 * Turns this event's measured prediction error (computeEventEpa's
 * residualStd - actual alliance score minus predicted, in points) into a
 * logistic `scale` for winProbability. Two alliances' errors are
 * independent, so the gap between them has variance 2 * residualStd^2; a
 * logistic distribution's std is scale * (pi / sqrt(3)), so
 * scale = residualStd * sqrt(2) / (pi / sqrt(3)).
 */
export function calibratedScale(residualStd) {
  if (!Number.isFinite(residualStd) || residualStd <= 0) return FALLBACK_SCALE;
  const scale = (residualStd * Math.sqrt(2)) / (Math.PI / Math.sqrt(3));
  return Math.max(MIN_SCALE, scale);
}

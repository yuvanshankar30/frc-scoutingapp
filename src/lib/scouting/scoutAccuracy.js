// Scout accuracy: how closely our match scouting adds up to The Blue Alliance's official numbers.
//
// TBA only knows alliances, not robots, so every check is per alliance per match: the three robots'
// scouted values (Data reports averaged across the scouts who covered each robot) summed, against the
// alliance total in TBA's score breakdown. Checks need all three robots scouted; an alliance with a robot
// nobody scouted is listed but left out of the totals, since its sum would be short by a whole robot.
//
//   Fuel        Data reports' balls scored            vs hubScore.totalCount (fuel scored, 1 point each)
//   Auto points Data reports' auto points              vs totalAutoPoints
//   Fouls       Robot reports' minor + major fouls     vs minorFoulCount + majorFoulCount (fouls committed)

import { reportKindOf } from './reportKinds.js';

const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const sum = (values) => values.reduce((total, value) => total + value, 0);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function correlation(pairs) {
  if (pairs.length < 3) return null;
  const mx = mean(pairs.map(([x]) => x));
  const my = mean(pairs.map(([, y]) => y));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

/** What TBA's breakdown says one alliance did, or null where this game's breakdown has no such field. */
export function tbaAllianceTotals(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return null;
  const minor = finite(breakdown.minorFoulCount);
  const major = finite(breakdown.majorFoulCount);
  return {
    fuel: finite(breakdown.hubScore?.totalCount ?? breakdown.hubScore?.totalPoints),
    auto: finite(breakdown.totalAutoPoints),
    fouls: minor === null && major === null ? null : (minor ?? 0) + (major ?? 0)
  };
}

const played = (match) =>
  Number.isFinite(match?.alliances?.red?.score) &&
  Number.isFinite(match?.alliances?.blue?.score) &&
  match.alliances.red.score >= 0 &&
  match.alliances.blue.score >= 0;

const METRICS = [
  { key: 'fuel', kind: 'data', field: 'balls_scored_average' },
  { key: 'auto', kind: 'data', field: 'auto_points_average' },
  { key: 'fouls', kind: 'robot', field: null }
];

function reportValue(entry, metric) {
  if (metric.key === 'fouls') {
    const minor = finite(entry.fouls_minor);
    const major = finite(entry.fouls_major);
    return minor === null && major === null ? null : (minor ?? 0) + (major ?? 0);
  }
  return finite(entry[metric.field]);
}

function summarize(alliances, key) {
  const checked = alliances.filter((alliance) => alliance[key].complete && alliance[key].tba !== null);
  const errors = checked.map((alliance) => alliance[key].scouted - alliance[key].tba);
  const tbaTotal = sum(checked.map((alliance) => alliance[key].tba));
  const ratios = checked.filter((alliance) => alliance[key].tba > 0).map((alliance) => alliance[key].ratio);
  return {
    checked: checked.length,
    // Share of TBA's total the scouts counted, over every checked alliance: 0.8 = scouts saw 80% of it.
    captured: tbaTotal > 0 ? sum(checked.map((alliance) => alliance[key].scouted)) / tbaTotal : null,
    medianRatio: median(ratios),
    meanError: mean(errors),
    meanAbsError: mean(errors.map(Math.abs)),
    correlation: correlation(checked.map((alliance) => [alliance[key].scouted, alliance[key].tba]))
  };
}

/**
 * Compares match scouting reports with TBA's results for every played match.
 *
 * @param {Array} matches TBA matches with score_breakdown (as /api/tba/event-matches returns them)
 * @param {Array} entries match_scout_entries rows for the event
 */
export function buildScoutAccuracy(matches = [], entries = []) {
  const byRobotMatch = new Map();
  for (const entry of entries || []) {
    if (!entry?.match_key || !entry?.team_key || entry.robot_present === false) continue;
    const key = `${entry.match_key}|${entry.team_key}`;
    if (!byRobotMatch.has(key)) byRobotMatch.set(key, []);
    byRobotMatch.get(key).push(entry);
  }

  const alliances = [];
  // Per scout: every alliance their report fed, and how far they sat from other scouts on the same robot.
  const scouts = new Map();
  const scoutRow = (name) => {
    if (!scouts.has(name)) scouts.set(name, { name, reports: 0, ratios: [], gaps: [], fuelReports: 0, foulReports: 0 });
    return scouts.get(name);
  };

  for (const match of matches || []) {
    if (!played(match)) continue;
    for (const side of ['red', 'blue']) {
      const teams = match.alliances[side].team_keys || [];
      const tba = tbaAllianceTotals(match.score_breakdown?.[side]);
      const row = { matchKey: match.key, compLevel: match.comp_level, side, teams, missing: {} };
      for (const metric of METRICS) {
        const perRobot = teams.map((team) => {
          const values = (byRobotMatch.get(`${match.key}|${team}`) || [])
            .filter((entry) => reportKindOf(entry) === metric.kind)
            .map((entry) => ({ scout: entry.scout_name || 'Unknown scout', value: reportValue(entry, metric) }))
            .filter((item) => item.value !== null);
          return { team, values, value: mean(values.map((item) => item.value)) };
        });
        const scouted = perRobot.every((robot) => robot.value !== null)
          ? sum(perRobot.map((robot) => robot.value))
          : null;
        const truth = tba?.[metric.key] ?? null;
        row[metric.key] = {
          scouted,
          partial: sum(perRobot.filter((robot) => robot.value !== null).map((robot) => robot.value)),
          robotsScouted: perRobot.filter((robot) => robot.value !== null).length,
          complete: scouted !== null,
          tba: truth,
          error: scouted !== null && truth !== null ? scouted - truth : null,
          ratio: scouted !== null && truth > 0 ? scouted / truth : null
        };
        row.missing[metric.key] = perRobot.filter((robot) => robot.value === null).map((robot) => robot.team);

        for (const robot of perRobot) {
          for (const item of robot.values) {
            const scout = scoutRow(item.scout);
            if (metric.key === 'fuel') scout.fuelReports += 1;
            if (metric.key === 'fouls') scout.foulReports += 1;
            if (metric.key === 'fuel' && row.fuel.ratio !== null) scout.ratios.push(row.fuel.ratio);
            // Agreement: the same robot in the same match, against the average of the other scouts on it.
            const others = robot.values.filter((other) => other !== item).map((other) => other.value);
            if (metric.key === 'fuel' && others.length) scout.gaps.push(item.value - mean(others));
          }
        }
      }
      alliances.push(row);
    }
  }

  for (const entry of entries || []) {
    if (entry?.scout_name || entry?.match_key) scoutRow(entry.scout_name || 'Unknown scout').reports += 1;
  }

  // Winner check: in matches where both alliances are fully scouted, did the side with more scouted fuel win?
  const byMatch = new Map();
  for (const row of alliances) {
    if (!byMatch.has(row.matchKey)) byMatch.set(row.matchKey, {});
    byMatch.get(row.matchKey)[row.side] = row;
  }
  let winnerChecked = 0;
  let winnerAgreed = 0;
  for (const match of matches || []) {
    const pair = byMatch.get(match?.key);
    if (!pair?.red?.fuel.complete || !pair?.blue?.fuel.complete) continue;
    const { red, blue } = match.alliances;
    if (red.score === blue.score || pair.red.fuel.scouted === pair.blue.fuel.scouted) continue;
    winnerChecked += 1;
    if (pair.red.fuel.scouted > pair.blue.fuel.scouted === red.score > blue.score) winnerAgreed += 1;
  }

  return {
    alliances,
    summary: {
      alliances: alliances.length,
      winner: {
        checked: winnerChecked,
        agreed: winnerAgreed,
        rate: winnerChecked ? winnerAgreed / winnerChecked : null
      },
      fuel: summarize(alliances, 'fuel'),
      auto: summarize(alliances, 'auto'),
      fouls: summarize(alliances, 'fouls')
    },
    scouts: [...scouts.values()]
      .map((scout) => ({
        name: scout.name,
        reports: scout.reports,
        checked: scout.ratios.length,
        // Median share of TBA's fuel the alliances this scout worked on added up to.
        captured: median(scout.ratios),
        // Against other scouts on the same robot-match: average gap (+ means they count more) and its size.
        comparisons: scout.gaps.length,
        bias: mean(scout.gaps),
        spread: mean(scout.gaps.map(Math.abs))
      }))
      .filter((scout) => scout.reports > 0)
      .sort((a, b) => b.reports - a.reports || a.name.localeCompare(b.name))
  };
}

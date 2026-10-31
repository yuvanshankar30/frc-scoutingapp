// The numbers behind Team View's charts and event team grid. Everything here is pure so it can be
// tested without a browser: the page fetches TBA and scouting data and hands it in.
//
// Match reports come in three kinds (reportKinds.js). Play data (auto points, balls scored, roles,
// starting position) is read from data reports, ratings from any report that has them, and robot
// condition from the reports that asked about it. A match nobody reported is null, never 0.
import { isDataReport, reportKindOf } from '$lib/scouting/reportKinds.js';
import { canonicalScoutMatchSuffix } from '$lib/scouting/scoutAssignmentCompletion.js';
import { compareMatchKeys, shortMatchLabel } from '$lib/matches/matchKeys.js';
import { mean } from '$lib/stats.js';

const teamNumber = (key) => String(key || '').replace(/^frc/i, '');
const teamKeyOf = (key) => {
  const digits = teamNumber(key).replace(/\D/g, '');
  return digits ? `frc${Number(digits)}` : '';
};

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A rating out of 5, or null when the scout left it blank (stored as 0) or marked it unknown. */
function rating(row, field) {
  if ((row?.ratings_unknown || []).includes(field)) return null;
  const value = num(row?.ratings?.[field]);
  return value && value > 0 ? value : null;
}

// Whether a report answered the robot-condition questions (see recordsCondition in scoutingStats.js).
const recordsCondition = (row) =>
  reportKindOf(row) !== 'performance' && (row?.form_version !== 2 || row?.teleop_robot_status != null);

const broke = (row) =>
  row?.crash_or_break === true || row?.intake_jammed === true || ['disabled', 'died'].includes(row?.robot_disabled);

/** Per-match metrics we chart, each a function of one report (null when that report does not say). */
export const MATCH_METRICS = Object.freeze({
  autoPoints: { label: 'Auto points', unit: 'pts', from: 'data', read: (row) => num(row?.auto_points_average) },
  ballsScored: {
    label: 'Teleop balls scored',
    unit: 'balls',
    from: 'data',
    read: (row) => num(row?.balls_scored_average)
  },
  autoCycles: { label: 'Auto cycles', unit: '', from: 'data', read: (row) => num(row?.auto_cycles) },
  accuracy: { label: 'Shot accuracy', unit: '/5', from: 'any', read: (row) => rating(row, 'Shot accuracy') },
  bps: { label: 'Shooting speed (BPS)', unit: '/5', from: 'any', read: (row) => rating(row, 'BPS') },
  driverSkill: {
    label: 'Driver skill',
    unit: '/5',
    from: 'any',
    read: (row) => {
      const value = num(row?.driver_skill);
      return value && value > 0 ? value : null;
    }
  },
  intakeSpeed: {
    label: 'Intake speed',
    unit: '/5',
    from: 'any',
    read: (row) => {
      const value = num(row?.intake_speed);
      return value && value > 0 ? value : null;
    }
  },
  offense: {
    label: 'Offense',
    unit: '/5',
    from: 'performance',
    read: (row) => {
      const value = num(row?.offense_rating);
      return value && value > 0 ? value : null;
    }
  },
  defense: {
    label: 'Defense',
    unit: '/5',
    from: 'performance',
    read: (row) => {
      const value = num(row?.defense_rating);
      return value && value > 0 ? value : null;
    }
  },
  fouls: {
    label: 'Fouls (fewer is better)',
    unit: '',
    from: 'robot',
    lowerIsBetter: true,
    read: (row) => {
      const minor = num(row?.fouls_minor);
      const major = num(row?.fouls_major);
      return minor == null && major == null ? null : (minor || 0) + (major || 0);
    }
  }
});

function rowsFor(entries, metric) {
  const from = MATCH_METRICS[metric]?.from;
  return (entries || []).filter((row) => {
    if (from === 'data') return isDataReport(row);
    if (from === 'performance') return reportKindOf(row) === 'performance';
    if (from === 'robot') return reportKindOf(row) === 'robot';
    return true;
  });
}

/**
 * One point per match the team played (or was scouted in), in field order. Two scouts on the same
 * match are averaged. `matchKeys` adds matches that were played but not scouted, so gaps show.
 */
export function perMatchSeries(entries, metric, matchKeys = []) {
  const read = MATCH_METRICS[metric]?.read;
  if (!read) return [];
  const byMatch = new Map();
  for (const key of matchKeys) byMatch.set(canonicalScoutMatchSuffix(key) || key, { matchKey: key, values: [] });
  for (const row of rowsFor(entries, metric)) {
    const id = canonicalScoutMatchSuffix(row?.match_key) || row?.match_key;
    if (!id) continue;
    if (!byMatch.has(id)) byMatch.set(id, { matchKey: row.match_key, values: [] });
    const value = read(row);
    if (value != null) byMatch.get(id).values.push(value);
  }
  return [...byMatch.values()]
    .sort((a, b) => compareMatchKeys(a.matchKey, b.matchKey))
    .map(({ matchKey, values }) => ({
      matchKey,
      label: shortMatchLabel(matchKey),
      value: mean(values),
      reports: values.length
    }));
}

/** Each team's average for a metric across the event: team key -> number (teams with no data left out). */
export function teamAverages(allEntries, metric) {
  const read = MATCH_METRICS[metric]?.read;
  const byTeam = new Map();
  for (const row of rowsFor(allEntries, metric)) {
    const key = teamKeyOf(row?.team_key);
    const value = read ? read(row) : null;
    if (!key || value == null) continue;
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(value);
  }
  return new Map([...byTeam].map(([key, values]) => [key, mean(values)]));
}

/** Five-number summary for a box plot, or null with no values. */
export function boxStats(values) {
  const sorted = (values || []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const quantile = (q) => {
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
  };
  return {
    min: sorted[0],
    q1: quantile(0.25),
    median: quantile(0.5),
    q3: quantile(0.75),
    max: sorted.at(-1),
    count: sorted.length
  };
}

/** Share of values strictly below `value`, plus half the ties: 0-100. Null when either side is missing. */
export function percentile(value, values) {
  const usable = (values || []).filter((entry) => Number.isFinite(entry));
  if (!Number.isFinite(value) || !usable.length) return null;
  const below = usable.filter((entry) => entry < value).length;
  const equal = usable.filter((entry) => entry === value).length;
  return Math.round(((below + equal / 2) / usable.length) * 100);
}

/**
 * Where a team sits in the event on each metric: [{ metric, label, value, eventMean, percentile, teams }].
 * A higher percentile is always better, so metrics where less is better (fouls) are flipped.
 */
export function percentileProfile(teamKey, allEntries, metrics = Object.keys(MATCH_METRICS)) {
  const key = teamKeyOf(teamKey);
  return metrics
    .map((metric) => {
      const averages = teamAverages(allEntries, metric);
      const value = averages.get(key) ?? null;
      const values = [...averages.values()];
      const rank = percentile(value, values);
      const better = rank == null || !MATCH_METRICS[metric].lowerIsBetter ? rank : 100 - rank;
      return {
        metric,
        label: MATCH_METRICS[metric].label,
        unit: MATCH_METRICS[metric].unit,
        value,
        eventMean: mean(values),
        percentile: better,
        teams: values.length
      };
    })
    .filter((row) => row.value != null);
}

/** How often each answer appears in a list or single-value column across data reports, most common first. */
export function answerCounts(entries, column) {
  const counts = new Map();
  for (const row of (entries || []).filter(isDataReport)) {
    const raw = row?.[column];
    const values = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
    for (const value of values) {
      const label = String(value || '').trim();
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Robot condition per match from the reports that asked: ok, broke (crash, jam, disabled or died),
 * or null when no such report exists for that match.
 */
export function reliabilityTimeline(entries, matchKeys = []) {
  const byMatch = new Map();
  for (const key of matchKeys) byMatch.set(canonicalScoutMatchSuffix(key) || key, { matchKey: key, reports: [] });
  for (const row of (entries || []).filter(recordsCondition)) {
    const id = canonicalScoutMatchSuffix(row?.match_key) || row?.match_key;
    if (!id) continue;
    if (!byMatch.has(id)) byMatch.set(id, { matchKey: row.match_key, reports: [] });
    byMatch.get(id).reports.push(row);
  }
  return [...byMatch.values()]
    .sort((a, b) => compareMatchKeys(a.matchKey, b.matchKey))
    .map(({ matchKey, reports }) => ({
      matchKey,
      label: shortMatchLabel(matchKey),
      status: !reports.length ? null : reports.some(broke) ? 'broke' : 'ok',
      card: reports.map((row) => row?.card).find((card) => card && card !== 'none') || null
    }));
}

/** TBA match keys this team has played at the event, in field order. */
export function playedMatchKeys(matches, teamKey) {
  const key = teamKeyOf(teamKey);
  return (matches || [])
    .filter(
      (match) =>
        Number.isFinite(match?.actual_time) ||
        (Number(match?.alliances?.red?.score) >= 0 && match?.alliances?.red?.score != null)
    )
    .filter((match) => ['red', 'blue'].some((color) => (match?.alliances?.[color]?.team_keys || []).includes(key)))
    .map((match) => match.key)
    .sort(compareMatchKeys);
}

/** The team's alliance score in each played match (TBA), for comparison with what we scouted. */
export function officialScores(matches, teamKey) {
  const key = teamKeyOf(teamKey);
  return (matches || [])
    .map((match) => {
      const color = ['red', 'blue'].find((side) => (match?.alliances?.[side]?.team_keys || []).includes(key));
      const score = num(match?.alliances?.[color]?.score);
      return color && score != null && score >= 0
        ? { matchKey: match.key, label: shortMatchLabel(match.key), value: score }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareMatchKeys(a.matchKey, b.matchKey));
}

/**
 * Rows for the event team grid: every team TBA lists at the event, with its name, rank, record,
 * OPR and how much of it we have scouted.
 */
export function teamGridRows({
  eventTeams = [],
  officialRows = [],
  matchEntries = [],
  pitEntries = [],
  matches = []
} = {}) {
  const official = new Map((officialRows || []).map((row) => [teamKeyOf(row?.team), row]));
  const pitTeams = new Set((pitEntries || []).map((row) => teamKeyOf(row?.team_key)));
  const ballsByTeam = teamAverages(matchEntries, 'ballsScored');
  const autoByTeam = teamAverages(matchEntries, 'autoPoints');
  const scoutedMatches = new Map();
  for (const row of (matchEntries || []).filter(isDataReport)) {
    const key = teamKeyOf(row?.team_key);
    if (!key) continue;
    if (!scoutedMatches.has(key)) scoutedMatches.set(key, new Set());
    scoutedMatches.get(key).add(canonicalScoutMatchSuffix(row.match_key) || row.match_key);
  }
  const keys = new Set((eventTeams || []).map((team) => teamKeyOf(team?.key || team?.team_number)).filter(Boolean));
  // Fall back to the schedule when TBA has not published the team list.
  if (!keys.size)
    for (const match of matches || [])
      for (const color of ['red', 'blue'])
        for (const key of match?.alliances?.[color]?.team_keys || []) keys.add(teamKeyOf(key));
  const names = new Map(
    (eventTeams || []).map((team) => [
      teamKeyOf(team?.key || team?.team_number),
      String(team?.nickname || team?.name || '').trim()
    ])
  );
  return [...keys].map((key) => {
    const row = official.get(key);
    const played = playedMatchKeys(matches, key).length;
    const scouted = scoutedMatches.get(key)?.size || 0;
    return {
      key,
      number: Number(teamNumber(key)),
      name: names.get(key) || '',
      rank: num(row?.rank),
      record: row ? `${row.wins ?? 0}-${row.losses ?? 0}-${row.ties ?? 0}` : '',
      opr: num(row?.epa ?? row?.opr),
      avgBalls: ballsByTeam.get(key) ?? null,
      avgAuto: autoByTeam.get(key) ?? null,
      scouted,
      played,
      coverage: played ? Math.min(1, scouted / played) : null,
      pitScouted: pitTeams.has(key)
    };
  });
}

export const GRID_SORTS = Object.freeze({
  rank: { label: 'Event rank', value: (row) => row.rank, ascending: true },
  number: { label: 'Team number', value: (row) => row.number, ascending: true },
  opr: { label: 'OPR', value: (row) => row.opr, ascending: false },
  balls: { label: 'Avg balls scored', value: (row) => row.avgBalls, ascending: false },
  auto: { label: 'Avg auto points', value: (row) => row.avgAuto, ascending: false },
  coverage: { label: 'Least scouted', value: (row) => row.coverage, ascending: true }
});

/** Sorted copy; teams missing the value go last, ties by team number. */
export function sortGridRows(rows, sortKey = 'rank') {
  const sort = GRID_SORTS[sortKey] || GRID_SORTS.rank;
  return [...(rows || [])].sort((a, b) => {
    const left = sort.value(a);
    const right = sort.value(b);
    const leftMissing = left == null || !Number.isFinite(left);
    const rightMissing = right == null || !Number.isFinite(right);
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    if (!leftMissing && left !== right) return sort.ascending ? left - right : right - left;
    return a.number - b.number;
  });
}

/** Search by number prefix or name substring. */
export function filterGridRows(rows, query) {
  const text = String(query || '')
    .trim()
    .toLowerCase();
  if (!text) return rows || [];
  const digits = text.replace(/\D/g, '');
  return (rows || []).filter(
    (row) => (digits && String(row.number).startsWith(digits)) || row.name.toLowerCase().includes(text)
  );
}

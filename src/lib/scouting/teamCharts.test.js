import { describe, expect, it } from 'vitest';
import {
  answerCounts,
  boxStats,
  filterGridRows,
  officialScores,
  percentile,
  percentileProfile,
  perMatchSeries,
  playedMatchKeys,
  reliabilityTimeline,
  sortGridRows,
  teamAverages,
  teamGridRows
} from './teamCharts.js';

// form_version 2 is the current form, where data reports leave the robot-condition questions to Robot scouting.
const report = (team, match, extra = {}) => ({
  team_key: team,
  match_key: `2026cabl_${match}`,
  report_kind: 'data',
  form_version: 2,
  ...extra
});

const entries = [
  report('frc5940', 'qm3', {
    balls_scored_average: 30,
    auto_points_average: 12,
    teleop_roles: ['Scorer'],
    starting_position: 'center'
  }),
  report('frc5940', 'qm3', {
    balls_scored_average: 40,
    auto_points_average: 8,
    teleop_roles: ['Scorer', 'Shuttler'],
    starting_position: 'center'
  }),
  report('frc5940', 'qm10', { balls_scored_average: 20, teleop_roles: ['Defense'], starting_position: 'left' }),
  report('frc5940', 'qm10', { report_kind: 'performance', ratings: { 'Shot accuracy': 4, BPS: 0 }, offense_rating: 5 }),
  report('frc5940', 'qm10', {
    report_kind: 'robot',
    form_version: 2,
    teleop_robot_status: 'ok',
    robot_disabled: 'died',
    fouls_minor: 1,
    fouls_major: 2
  }),
  report('frc254', 'qm3', { balls_scored_average: 60, ratings: { 'Shot accuracy': 5 } }),
  report('frc254', 'qm10', { balls_scored_average: 50 })
];

const tba = (key, red, blue, scores) => ({
  key,
  actual_time: scores ? 1 : null,
  alliances: {
    red: { team_keys: red, score: scores ? scores[0] : -1 },
    blue: { team_keys: blue, score: scores ? scores[1] : -1 }
  }
});
const matches = [
  tba('2026cabl_qm10', ['frc5940', 'frc1', 'frc2'], ['frc254', 'frc3', 'frc4'], [80, 95]),
  tba('2026cabl_qm3', ['frc254', 'frc5', 'frc6'], ['frc5940', 'frc7', 'frc8'], [70, 90]),
  tba('2026cabl_qm20', ['frc5940', 'frc9', 'frc10'], ['frc11', 'frc12', 'frc13'], null)
];

describe('perMatchSeries', () => {
  it('averages scouts on the same match and orders matches the way they are played', () => {
    expect(
      perMatchSeries(
        entries.filter((row) => row.team_key === 'frc5940'),
        'ballsScored'
      )
    ).toEqual([
      { matchKey: '2026cabl_qm3', label: 'Q3', value: 35, reports: 2 },
      { matchKey: '2026cabl_qm10', label: 'Q10', value: 20, reports: 1 }
    ]);
  });

  it('only reads play data from data reports and ratings from any report, treating a 0 rating as unanswered', () => {
    const mine = entries.filter((row) => row.team_key === 'frc5940');
    expect(perMatchSeries(mine, 'accuracy').map((point) => point.value)).toEqual([null, 4]);
    expect(perMatchSeries(mine, 'bps').every((point) => point.value === null)).toBe(true);
    expect(perMatchSeries(mine, 'fouls').map((point) => point.value)).toEqual([3]);
  });

  it('shows played matches nobody scouted as gaps, not zeros', () => {
    const series = perMatchSeries([], 'ballsScored', ['2026cabl_qm3', '2026cabl_qm10']);
    expect(series.map((point) => [point.label, point.value])).toEqual([
      ['Q3', null],
      ['Q10', null]
    ]);
  });
});

describe('event comparisons', () => {
  it('averages every team across the event', () => {
    const averages = teamAverages(entries, 'ballsScored');
    expect(averages.get('frc5940')).toBeCloseTo((30 + 40 + 20) / 3);
    expect(averages.get('frc254')).toBe(55);
  });

  it('computes a five-number summary', () => {
    expect(boxStats([4, 1, 3, 2, 5])).toEqual({ min: 1, q1: 2, median: 3, q3: 4, max: 5, count: 5 });
    expect(boxStats([])).toBeNull();
  });

  it('places a value among the event with ties counted half', () => {
    expect(percentile(3, [1, 2, 3, 4])).toBe(63);
    expect(percentile(10, [1, 2])).toBe(100);
    expect(percentile(null, [1])).toBeNull();
  });

  it('builds a percentile profile only from metrics the team has data for', () => {
    const profile = percentileProfile('5940', entries, ['ballsScored', 'accuracy', 'autoCycles']);
    expect(profile.map((row) => row.metric)).toEqual(['ballsScored', 'accuracy']);
    expect(profile[0]).toMatchObject({ teams: 2, percentile: 25 });
  });

  it('flips metrics where less is better, so a high percentile always means better', () => {
    const fouls = [
      { team_key: 'frc1', match_key: 'e_qm1', report_kind: 'robot', fouls_minor: 0 },
      { team_key: 'frc2', match_key: 'e_qm1', report_kind: 'robot', fouls_minor: 4 }
    ];
    expect(percentileProfile('frc1', fouls, ['fouls'])[0].percentile).toBe(75);
    expect(percentileProfile('frc2', fouls, ['fouls'])[0].percentile).toBe(25);
  });
});

describe('answers and reliability', () => {
  it('counts list and single answers from data reports, most common first', () => {
    const mine = entries.filter((row) => row.team_key === 'frc5940');
    expect(answerCounts(mine, 'teleop_roles')).toEqual([
      { label: 'Scorer', count: 2 },
      { label: 'Defense', count: 1 },
      { label: 'Shuttler', count: 1 }
    ]);
    expect(answerCounts(mine, 'starting_position')).toEqual([
      { label: 'center', count: 2 },
      { label: 'left', count: 1 }
    ]);
  });

  it('marks a match broke when a condition report says so, and unknown when no report asked', () => {
    const mine = entries.filter((row) => row.team_key === 'frc5940');
    expect(reliabilityTimeline(mine, ['2026cabl_qm3', '2026cabl_qm10']).map((row) => [row.label, row.status])).toEqual([
      ['Q3', null],
      ['Q10', 'broke']
    ]);
  });

  it('counts an old-form data report as a condition report', () => {
    const old = [report('frc5940', 'qm3', { form_version: 1, crash_or_break: false })];
    expect(reliabilityTimeline(old).map((row) => row.status)).toEqual(['ok']);
  });
});

describe('TBA lookups', () => {
  it('lists the matches a team has played in field order', () => {
    expect(playedMatchKeys(matches, '5940')).toEqual(['2026cabl_qm3', '2026cabl_qm10']);
  });

  it('reads the team alliance score from each played match', () => {
    expect(officialScores(matches, 'frc5940').map((row) => [row.label, row.value])).toEqual([
      ['Q3', 90],
      ['Q10', 80]
    ]);
  });
});

describe('team grid', () => {
  const rows = teamGridRows({
    eventTeams: [
      { key: 'frc5940', nickname: 'Gearheads' },
      { key: 'frc254', nickname: 'The Cheesy Poofs' },
      { key: 'frc1', nickname: '' }
    ],
    officialRows: [
      { team: 5940, rank: 2, epa: 41.5, wins: 5, losses: 1, ties: 0 },
      { team: 254, rank: 1, epa: 55, wins: 6, losses: 0, ties: 0 }
    ],
    matchEntries: entries,
    pitEntries: [{ team_key: 'frc5940' }],
    matches
  });
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));

  it('lists every TBA team with rank, record, OPR and scouting coverage', () => {
    expect(byKey.frc5940).toMatchObject({
      number: 5940,
      name: 'Gearheads',
      rank: 2,
      record: '5-1-0',
      opr: 41.5,
      scouted: 2,
      played: 2,
      coverage: 1,
      pitScouted: true
    });
    expect(byKey.frc1).toMatchObject({
      rank: null,
      opr: null,
      avgBalls: null,
      scouted: 0,
      played: 1,
      coverage: 0,
      pitScouted: false
    });
  });

  it('sorts with missing values last and filters by number or name', () => {
    expect(sortGridRows(rows, 'rank').map((row) => row.number)).toEqual([254, 5940, 1]);
    expect(sortGridRows(rows, 'balls').map((row) => row.number)).toEqual([254, 5940, 1]);
    expect(sortGridRows(rows, 'coverage')[0].number).toBe(1);
    expect(filterGridRows(rows, '59').map((row) => row.number)).toEqual([5940]);
    expect(filterGridRows(rows, 'cheesy').map((row) => row.number)).toEqual([254]);
  });
});

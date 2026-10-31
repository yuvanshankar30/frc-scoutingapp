import { describe, it, expect } from 'vitest';
import {
  aggregateTeams,
  findDisputes,
  groupByMatch,
  matchesQuery,
  matchNumber,
  reportFlags,
  scoutStats,
  sortTeams
} from './scoutData.js';

const report = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  match_key: '2026cc_qm10',
  team_key: 'frc5940',
  created_by: 'u1',
  scout_name: 'Ana',
  balls_scored_average: 100,
  auto_points_average: 20,
  created_at: '2026-09-20T10:00:00Z',
  ...over
});

describe('matchNumber', () => {
  it('reads real keys and free text', () => {
    expect(matchNumber({ match_key: '2026cc_qm64' })).toBe(64);
    expect(matchNumber({ match_key: '2026cc_Quals 70' })).toBe(70);
    expect(matchNumber({ match_key: '' })).toBeNull();
  });
});

describe('reportFlags', () => {
  it('names what went wrong', () => {
    expect(reportFlags(report())).toEqual([]);
    expect(
      reportFlags(
        report({ auto_collision: true, significant_crash: true, teleop_robot_status: 'dead', card: 'yellow' })
      )
    ).toEqual(['Auto collision', 'Crash', 'Went dead', 'yellow card']);
    expect(reportFlags(report({ card: 'none', robot_disabled: 'no' }))).toEqual([]);
  });
});

describe('findDisputes', () => {
  it('flags two scouts who disagree about one robot', () => {
    const a = report({ balls_scored_average: 50 });
    const b = report({ balls_scored_average: 210 });
    const c = report({ team_key: 'frc254', balls_scored_average: 120 });
    const d = report({ team_key: 'frc254', balls_scored_average: 130 });
    const disputes = findDisputes([a, b, c, d]);
    expect([...disputes.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(disputes.get(a.id)).toContain('210');
  });
});

describe('aggregateTeams', () => {
  it('averages and orders a team’s matches', () => {
    const rows = aggregateTeams([
      report({ match_key: '2026cc_qm12', balls_scored_average: 200, ratings: { 'Shot accuracy': 4 } }),
      report({
        match_key: '2026cc_qm3',
        balls_scored_average: 100,
        ratings: { 'Shot accuracy': 2 },
        created_by: 'u2',
        scout_name: 'Ben'
      }),
      report({ team_key: 'frc254', balls_scored_average: null })
    ]);
    const team = rows.find((row) => row.teamKey === 'frc5940');
    expect(team.balls).toBe(150);
    expect(team.accuracy).toBe(3);
    expect(team.scouts).toBe(2);
    expect(team.series.map((point) => point.match)).toEqual([3, 12]);
    expect(team.reports[0].match_key).toBe('2026cc_qm12');
    expect(rows.find((row) => row.teamKey === 'frc254').balls).toBeNull();
  });
  it('sorts by a column, keeping teams with no data last', () => {
    const rows = aggregateTeams([
      report({ balls_scored_average: 10 }),
      report({ team_key: 'frc254', balls_scored_average: 90 }),
      report({ team_key: 'frc1', balls_scored_average: null })
    ]);
    expect(sortTeams(rows, 'balls').map((row) => row.number)).toEqual([254, 5940, 1]);
    expect(sortTeams(rows, 'number').map((row) => row.number)).toEqual([1, 254, 5940]);
  });
});

describe('scoutStats and groupByMatch', () => {
  it('counts per scout and groups matches newest first', () => {
    const list = [
      report(),
      report({ match_key: '2026cc_qm11', teleop_notes: 'fast' }),
      report({ scout_name: 'Ben', created_by: 'u2' })
    ];
    const scouts = scoutStats(list);
    expect(scouts.find((row) => row.name === 'Ana')).toMatchObject({ count: 2, noted: 1 });
    expect(groupByMatch(list).map((group) => group.number)).toEqual([11, 10]);
  });
});

describe('matchesQuery', () => {
  it('needs every word to match something', () => {
    const r = report();
    expect(matchesQuery(r, '5940')).toBe(true);
    expect(matchesQuery(r, '5940 ana')).toBe(true);
    expect(matchesQuery(r, 'qm10')).toBe(true);
    expect(matchesQuery(r, '254')).toBe(false);
    expect(matchesQuery(r, '')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { matchTimeline, sortTeams, teamStats } from './strategyBoard.js';

const row = (teamNumber, summary = {}, extra = {}) => ({
  teamKey: `frc${teamNumber}`,
  teamNumber: String(teamNumber),
  matchEntries: [],
  openProblems: [],
  matchScoutSummary: { ratingAverages: {}, matchesScouted: 0, ...summary },
  autoAverage: null,
  ...extra
});

describe('teamStats', () => {
  it('takes EPA and its parts from the model, ranks from TBA and counts reports by kind', () => {
    const stats = teamStats(
      row(
        5940,
        { avgBallsScored: 120, ratingAverages: { 'Shot accuracy': 4, BPS: 3 } },
        {
          matchEntries: [{ report_kind: 'data' }, { report_kind: 'performance' }, {}]
        }
      ),
      {
        epaRow: { epa: 210, components: { auto: 40, teleop: 165, endgame: 5 }, incidentRate: 0.1 },
        officialRow: { rank: 3, wins: 7, losses: 2, ties: 0 },
        epaRank: 2
      }
    );
    expect(stats).toMatchObject({
      epa: 210,
      auto: 40,
      rank: 3,
      record: '7-2-0',
      epaRank: 2,
      fuel: 120,
      accuracy: 4,
      bps: 3,
      incidentRate: 0.1
    });
    expect(stats.kinds).toEqual({ data: 2, performance: 1, robot: 0 });
  });

  it('leaves anything nobody measured as null, not 0', () => {
    const stats = teamStats(row(1));
    expect(stats.epa).toBeNull();
    expect(stats.fuel).toBeNull();
    expect(stats.rank).toBeNull();
  });
});

describe('sortTeams', () => {
  const items = [
    { row: row(1), stats: { epa: 50, rank: 3, incidentRate: 0.4, kinds: { data: 1, performance: 0, robot: 0 } } },
    { row: row(2), stats: { epa: null, rank: 1, incidentRate: null, kinds: { data: 0, performance: 0, robot: 0 } } },
    { row: row(3), stats: { epa: 90, rank: 2, incidentRate: 0, kinds: { data: 3, performance: 0, robot: 0 } } }
  ];
  const order = (key) => sortTeams(items, key).map((item) => item.row.teamNumber);

  it('puts the highest EPA first and teams with no value last', () => {
    expect(order('epa')).toEqual(['3', '1', '2']);
  });

  it('sorts event rank and reliability ascending (best first)', () => {
    expect(order('rank')).toEqual(['2', '3', '1']);
    expect(order('reliability')).toEqual(['3', '1', '2']);
  });
});

describe('matchTimeline', () => {
  const match = (number, red, blue, redScore, blueScore) => ({
    key: `2026tst_qm${number}`,
    comp_level: 'qm',
    match_number: number,
    alliances: {
      red: { team_keys: red, score: redScore },
      blue: { team_keys: blue, score: blueScore }
    }
  });

  it("lists the team's matches in order with scouted points, results and no-shows", () => {
    const matches = [
      match(2, ['frc4', 'frc5', 'frc6'], ['frc1', 'frc2', 'frc3'], 50, 80),
      match(1, ['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6'], 100, 90),
      match(3, ['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6'], -1, -1),
      match(4, ['frc7', 'frc8', 'frc9'], ['frc4', 'frc5', 'frc6'], 10, 20)
    ];
    const entries = [
      { match_key: '2026tst_qm1', team_key: 'frc1', report_kind: 'data', balls_scored_average: 30 },
      { match_key: '2026tst_qm2', team_key: 'frc1', report_kind: 'data', robot_present: false }
    ];
    const timeline = matchTimeline('frc1', matches, entries);
    expect(timeline.map((entry) => entry.label)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(timeline[0]).toMatchObject({ side: 'red', result: 'win', points: 30, noShow: false });
    expect(timeline[1]).toMatchObject({ side: 'blue', result: 'win', points: 0, noShow: true, incident: true });
    expect(timeline[2]).toMatchObject({ played: false, result: null, points: null });
  });
});

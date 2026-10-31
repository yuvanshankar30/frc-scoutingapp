import { describe, expect, it } from 'vitest';
import { buildScoutAccuracy, tbaAllianceTotals } from './scoutAccuracy.js';

const breakdown = (fuel, auto, minor = 0, major = 0) => ({
  hubScore: { totalCount: fuel },
  totalAutoPoints: auto,
  minorFoulCount: minor,
  majorFoulCount: major
});
const match = (number, red, blue) => ({
  key: `2026tst_qm${number}`,
  comp_level: 'qm',
  match_number: number,
  alliances: {
    red: { team_keys: ['frc1', 'frc2', 'frc3'], score: red.fuel + red.auto },
    blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: blue.fuel + blue.auto }
  },
  score_breakdown: { red: breakdown(red.fuel, red.auto, red.minor), blue: breakdown(blue.fuel, blue.auto) }
});
const data = (number, team, balls, auto, scout = 'Sam') => ({
  match_key: `2026tst_qm${number}`,
  team_key: team,
  report_kind: 'data',
  scout_name: scout,
  balls_scored_average: balls,
  auto_points_average: auto
});

describe('tbaAllianceTotals', () => {
  it("reads fuel, auto points and the alliance's own fouls from the breakdown", () => {
    expect(tbaAllianceTotals(breakdown(99, 9, 2, 1))).toEqual({ fuel: 99, auto: 9, fouls: 3 });
    expect(tbaAllianceTotals(null)).toBeNull();
  });
});

describe('buildScoutAccuracy', () => {
  const matches = [match(1, { fuel: 100, auto: 20, minor: 2 }, { fuel: 50, auto: 10 })];

  it('adds the three robots and compares the sum with TBA', () => {
    const entries = [data(1, 'frc1', 30, 5), data(1, 'frc2', 30, 5), data(1, 'frc3', 20, 6)];
    const { alliances, summary } = buildScoutAccuracy(matches, entries);
    const red = alliances.find((row) => row.side === 'red');
    expect(red.fuel).toMatchObject({ scouted: 80, tba: 100, error: -20, ratio: 0.8, complete: true });
    expect(red.auto).toMatchObject({ scouted: 16, tba: 20 });
    expect(summary.fuel.checked).toBe(1);
    expect(summary.fuel.captured).toBeCloseTo(0.8, 6);
  });

  it('averages two scouts on one robot, and measures each against the other', () => {
    const entries = [
      data(1, 'frc1', 20, 5, 'Ana'),
      data(1, 'frc1', 40, 5, 'Ben'),
      data(1, 'frc2', 30, 5),
      data(1, 'frc3', 20, 5)
    ];
    const { alliances, scouts } = buildScoutAccuracy(matches, entries);
    expect(alliances.find((row) => row.side === 'red').fuel.scouted).toBe(80);
    expect(scouts.find((scout) => scout.name === 'Ana')).toMatchObject({ comparisons: 1, bias: -20 });
    expect(scouts.find((scout) => scout.name === 'Ben')).toMatchObject({ comparisons: 1, bias: 20 });
  });

  it('leaves an alliance with an unscouted robot out of the totals and names the robot', () => {
    const { alliances, summary } = buildScoutAccuracy(matches, [data(1, 'frc1', 30, 5), data(1, 'frc2', 30, 5)]);
    const red = alliances.find((row) => row.side === 'red');
    expect(red.fuel.complete).toBe(false);
    expect(red.fuel.partial).toBe(60);
    expect(red.missing.fuel).toEqual(['frc3']);
    expect(summary.fuel.checked).toBe(0);
  });

  it('checks Robot-report fouls against the fouls TBA says the alliance committed', () => {
    const robot = (team, minor) => ({
      match_key: '2026tst_qm1',
      team_key: team,
      report_kind: 'robot',
      scout_name: 'Rae',
      fouls_minor: minor,
      fouls_major: 0
    });
    const { alliances } = buildScoutAccuracy(matches, [robot('frc1', 1), robot('frc2', 0), robot('frc3', 1)]);
    expect(alliances.find((row) => row.side === 'red').fouls).toMatchObject({ scouted: 2, tba: 2, error: 0 });
  });

  it('reports how often more scouted fuel means the alliance that actually won', () => {
    const entries = ['frc1', 'frc2', 'frc3', 'frc4', 'frc5', 'frc6'].map((team, index) =>
      data(1, team, index < 3 ? 30 : 10, 5)
    );
    expect(buildScoutAccuracy(matches, entries).summary.winner).toEqual({ checked: 1, agreed: 1, rate: 1 });
  });

  it('skips unplayed matches and robots marked as no-shows', () => {
    const unplayed = { ...match(2, { fuel: 0, auto: 0 }, { fuel: 0, auto: 0 }) };
    unplayed.alliances.red.score = -1;
    const entries = [{ ...data(1, 'frc1', 30, 5), robot_present: false }];
    const { alliances } = buildScoutAccuracy([...matches, unplayed], entries);
    expect(alliances).toHaveLength(2);
    expect(alliances.find((row) => row.side === 'red').fuel.robotsScouted).toBe(0);
  });
});

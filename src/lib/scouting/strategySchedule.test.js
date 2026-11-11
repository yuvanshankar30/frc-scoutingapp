import { describe, expect, it } from 'vitest';
import { buildStrategySchedule, matchOrder, teamAlliance } from './strategySchedule.js';

const team = 'frc5940';
const match = (number, extra = {}) => ({
  key: `2026test_qm${number}`,
  comp_level: 'qm',
  match_number: number,
  predicted_time: 1_800_000_000 + number * 600,
  alliances: { red: { team_keys: [team, 'frc1', 'frc2'] }, blue: { team_keys: ['frc3', 'frc4', 'frc5'] } },
  ...extra
});

describe('strategy schedule', () => {
  it('identifies the selected team alliance', () => {
    expect(teamAlliance(match(1), team)).toBe('red');
    expect(teamAlliance(match(1, { alliances: { red: { team_keys: [] }, blue: { team_keys: [team] } } }), team)).toBe(
      'blue'
    );
  });

  it('counts future matches chronologically and shows the next match at the top', () => {
    const schedule = buildStrategySchedule([match(3), match(1), match(2)], team);
    expect(schedule.realUpcoming.map((entry) => entry.match_number)).toEqual([1, 2, 3]);
    expect(schedule.upcoming.map((entry) => entry.match.match_number)).toEqual([1, 2, 3]);
    expect(schedule.upcoming.map((entry) => entry.matchesAway)).toEqual([0, 1, 2]);
  });

  it('does not let a practice match change the real match-away count', () => {
    const schedule = buildStrategySchedule(
      [match(1), match(2), match(99, { is_test_market: true, predicted_time: null })],
      team
    );
    expect(schedule.upcoming.map((entry) => entry.matchesAway)).toEqual([0, 1, null]);
  });

  it('keeps played matches separate and newest-first', () => {
    const schedule = buildStrategySchedule(
      [match(2, { actual_time: 1_800_001_200 }), match(1, { actual_time: 1_800_000_600 })],
      team
    );
    expect(schedule.upcoming).toEqual([]);
    expect(schedule.played.map((entry) => entry.match.match_number)).toEqual([2, 1]);
  });
});

describe('matchOrder', () => {
  it('sorts by time, then in play order, so an untimed playoff never lands among the quals', () => {
    const qm2 = match(2);
    const qm9 = match(9);
    const sf1 = { key: '2026test_sf1m1', comp_level: 'sf', set_number: 1, match_number: 1 };
    expect([sf1, qm9, qm2].sort(matchOrder).map((entry) => entry.key)).toEqual([
      '2026test_qm2',
      '2026test_qm9',
      '2026test_sf1m1'
    ]);
  });
});

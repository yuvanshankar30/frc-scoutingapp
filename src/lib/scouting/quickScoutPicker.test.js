import { describe, expect, it } from 'vitest';
import { isPlayed, nearbyMatches, stageOf, startingMatch } from './quickScoutPicker.js';

const match = (
  key,
  comp_level,
  match_number,
  played = false,
  red = ['frc1', 'frc2', 'frc3'],
  blue = ['frc4', 'frc5', 'frc6']
) => ({
  key,
  comp_level,
  match_number,
  alliances: { red: { team_keys: red, score: played ? 30 : -1 }, blue: { team_keys: blue, score: played ? 20 : -1 } }
});

describe('stageOf', () => {
  it('groups match levels into the three tabs', () => {
    expect(stageOf({ comp_level: 'qm' })).toBe('qm');
    for (const level of ['ef', 'qf', 'sf', 'f']) expect(stageOf({ comp_level: level })).toBe('playoff');
    expect(stageOf({ comp_level: 'pm' })).toBe('pm');
    expect(stageOf({})).toBe('qm');
  });
});

describe('isPlayed', () => {
  it('uses the scores, since TBA reports -1 before a match is played', () => {
    expect(isPlayed(match('a', 'qm', 1, true))).toBe(true);
    expect(isPlayed(match('a', 'qm', 1, false))).toBe(false);
    expect(isPlayed({ actual_time: 1700000000 })).toBe(true);
  });
});

describe('nearbyMatches', () => {
  const list = Array.from({ length: 80 }, (_, index) => ({ key: `m${index}` }));
  it('shows everything for playoffs or a short list', () => {
    expect(nearbyMatches(list, 40, 'playoff')).toHaveLength(80);
    expect(nearbyMatches(list.slice(0, 5), 2, 'qm')).toHaveLength(5);
  });
  it('centres a window of nine on the current match', () => {
    expect(nearbyMatches(list, 40, 'qm').map((item) => item.key)).toEqual(list.slice(36, 45).map((item) => item.key));
  });
  it('keeps the window inside the list at both ends and when nothing is selected', () => {
    expect(nearbyMatches(list, 0, 'qm')[0].key).toBe('m0');
    expect(nearbyMatches(list, 79, 'qm').at(-1).key).toBe('m79');
    expect(nearbyMatches(list, -1, 'qm')).toHaveLength(9);
    expect(nearbyMatches(list, 79, 'qm')).toHaveLength(9);
  });
});

describe('startingMatch', () => {
  const matches = [
    match('q1', 'qm', 1, true),
    match('q2', 'qm', 2, true),
    match('q3', 'qm', 3),
    match('q4', 'qm', 4, false, ['frc9'], ['frc8'])
  ];
  it('starts at the next unplayed qualification', () => {
    expect(startingMatch(matches).key).toBe('q3');
  });
  it("prefers the scout's own next assigned match", () => {
    expect(startingMatch(matches, (key, team) => key === 'q4' && team === 'frc9').key).toBe('q4');
  });
  it('falls back to an assigned match that is already played, then the first match', () => {
    const allPlayed = [match('q1', 'qm', 1, true), match('q2', 'qm', 2, true)];
    expect(startingMatch(allPlayed, (key) => key === 'q2').key).toBe('q2');
    expect(startingMatch(allPlayed).key).toBe('q1');
    expect(startingMatch([])).toBeNull();
  });
  it('moves on to playoffs when qualifications are all played', () => {
    const list = [match('q1', 'qm', 1, true), match('sf1', 'sf', 1)];
    expect(startingMatch(list).key).toBe('sf1');
  });
});

import { describe, expect, it } from 'vitest';
import {
  findNextMatch,
  formatCountdown,
  ourResults,
  scoutingCoverage,
  standingFrom,
  teamsAheadOf
} from './dashboard.js';

const match = (comp_level, match_number, red, blue, extra = {}) => ({
  comp_level,
  match_number,
  set_number: 1,
  key: `2026x_${comp_level}${match_number}`,
  alliances: { red: { team_keys: red, score: -1 }, blue: { team_keys: blue, score: -1 } },
  ...extra
});
const us = 'frc5940';

describe('findNextMatch', () => {
  it('finds our first unplayed match with partners, opponents and our alliance color', () => {
    const matches = [
      match('qm', 3, ['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']),
      match('qm', 5, ['frc10', us, 'frc12'], ['frc20', 'frc21', 'frc22'], { predicted_time: 2000 }),
      match('qm', 9, [us, 'frc30', 'frc31'], ['frc40', 'frc41', 'frc42'])
    ];
    const next = findNextMatch(matches, us);
    expect(next.label).toBe('Qual 5');
    expect(next.ourColor).toBe('red');
    expect(next.partners).toEqual(['frc10', 'frc12']);
    expect(next.opponents).toEqual(['frc20', 'frc21', 'frc22']);
    expect(next.startsAtMs).toBe(2000 * 1000);
    expect(next.matchesAway).toBe(0);
  });

  it('skips matches that already have an actual time or a final score, and sorts qualifications before playoffs', () => {
    const played = match('qm', 2, [us, 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6'], { actual_time: 100 });
    const scored = match('qm', 4, [us, 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']);
    scored.alliances.red.score = 80;
    scored.alliances.blue.score = 70;
    const playoff = match('sf', 1, [us, 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']);
    const nextQual = match('qm', 11, ['frc9', 'frc8', us], ['frc4', 'frc5', 'frc6']);
    const next = findNextMatch([playoff, played, scored, nextQual], us);
    expect(next.label).toBe('Qual 11');
    expect(next.ourColor).toBe('red');
  });

  it('reports how many of our matches are still ahead of the next one', () => {
    const matches = [
      match('qm', 1, [us, 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']),
      match('qm', 8, [us, 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6'])
    ];
    expect(findNextMatch(matches, us).matchesAway).toBe(0);
  });

  it('returns null when we have nothing left to play', () => {
    expect(findNextMatch([match('qm', 1, ['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6'])], us)).toBeNull();
    expect(findNextMatch([], us)).toBeNull();
  });
});

describe('ourResults', () => {
  it('turns scored matches into W/L/T from our side regardless of alliance color', () => {
    const win = match('qm', 1, [us, 'a', 'b'], ['c', 'd', 'e']);
    win.alliances.red.score = 90;
    win.alliances.blue.score = 60;
    const loss = match('qm', 2, ['c', 'd', 'e'], [us, 'a', 'b']);
    loss.alliances.red.score = 100;
    loss.alliances.blue.score = 80;
    const tie = match('qm', 3, [us, 'a', 'b'], ['c', 'd', 'e']);
    tie.alliances.red.score = 70;
    tie.alliances.blue.score = 70;
    expect(ourResults([tie, loss, win], us).map((r) => [r.label, r.result, r.ours, r.theirs])).toEqual([
      ['Qual 1', 'W', 90, 60],
      ['Qual 2', 'L', 80, 100],
      ['Qual 3', 'T', 70, 70]
    ]);
  });
});

describe('standing', () => {
  const rankings = [
    { team_key: 'frc254', rank: 1, record: { wins: 8, losses: 0, ties: 0 }, matches_played: 8 },
    { team_key: 'frc1678', rank: 2, record: { wins: 7, losses: 1, ties: 0 }, matches_played: 8 },
    { team_key: us, rank: 3, record: { wins: 6, losses: 2, ties: 0 }, matches_played: 8 },
    { team_key: 'frc604', rank: 4, record: { wins: 5, losses: 3, ties: 0 }, matches_played: 8 }
  ];
  it('reads our rank and record', () => {
    expect(standingFrom(rankings, us)).toEqual({
      rank: 3,
      totalTeams: 4,
      wins: 6,
      losses: 2,
      ties: 0,
      matchesPlayed: 8
    });
  });
  it('is null when we are not ranked yet', () => {
    expect(standingFrom(rankings.slice(0, 2), us)).toBeNull();
    expect(standingFrom(undefined, us)).toBeNull();
  });
  it('lists the teams ranked ahead of us, nearest first only up to the limit', () => {
    expect(teamsAheadOf(rankings, us)).toEqual([
      { teamKey: 'frc254', rank: 1 },
      { teamKey: 'frc1678', rank: 2 }
    ]);
    expect(teamsAheadOf(rankings, us, 1)).toEqual([{ teamKey: 'frc1678', rank: 2 }]);
    expect(teamsAheadOf(rankings, 'frc1', 3)).toEqual([]);
  });
});

describe('scoutingCoverage', () => {
  it('counts teams with a match report, not reports, and open problems only', () => {
    const result = scoutingCoverage({
      teams: [{ key: 'frc1' }, { key: 'frc2' }, { key: 'frc3' }, { key: 'frc4' }],
      matchEntries: [{ team_key: 'frc1' }, { team_key: 'frc1' }, { team_key: 'frc2' }, { team_key: 'frc99' }],
      pitEntries: [{ team_key: 'frc1' }, { team_key: 'frc3' }],
      problems: [{ resolved: false }, { resolved: true }, {}]
    });
    expect(result).toEqual({
      teamsTotal: 4,
      teamsScouted: 2,
      matchReports: 4,
      pitProfiles: 2,
      openProblems: 2,
      percentScouted: 50
    });
  });
  it('has no percentage until a roster is known', () => {
    expect(scoutingCoverage({}).percentScouted).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('formats minutes and hours, and says now when it is imminent or past', () => {
    expect(formatCountdown(30 * 1000)).toBe('now');
    expect(formatCountdown(-5000)).toBe('now');
    expect(formatCountdown(12 * 60000)).toBe('12 min');
    expect(formatCountdown(65 * 60000)).toBe('1 h 5 min');
    expect(formatCountdown(120 * 60000)).toBe('2 h');
    expect(formatCountdown(null)).toBeNull();
  });
});

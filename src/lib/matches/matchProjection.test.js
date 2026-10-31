import { describe, expect, it } from 'vitest';
import { allianceProjectedScore, allianceStrength, isMatchPlayed, projectMatch } from './matchProjection.js';

describe('allianceStrength', () => {
  it('sums known team power and defaults an unscouted team to average (50)', () => {
    const scoutPower = new Map([
      ['frc1', 80],
      ['frc2', 60]
    ]);
    expect(allianceStrength(['frc1', 'frc2', 'frc3'], scoutPower)).toBe(80 + 60 + 50);
  });

  it('returns null when nothing about the alliance is known yet', () => {
    expect(allianceStrength(['frc9', 'frc8', 'frc7'], new Map())).toBeNull();
  });
});

describe('projectMatch', () => {
  const scoutPower = new Map([
    ['frc1', 80],
    ['frc2', 80],
    ['frc3', 80],
    ['frc4', 20],
    ['frc5', 20],
    ['frc6', 20]
  ]);
  const match = {
    alliances: { red: { team_keys: ['frc1', 'frc2', 'frc3'] }, blue: { team_keys: ['frc4', 'frc5', 'frc6'] } }
  };

  it('favors the stronger alliance with a probability above 50%', () => {
    const { redWinProbability } = projectMatch(match, scoutPower);
    expect(redWinProbability).toBeGreaterThan(0.5);
    expect(redWinProbability).toBeLessThan(1);
  });

  it('gives an even match exactly 50/50', () => {
    const evenMatch = { alliances: { red: { team_keys: ['frc1'] }, blue: { team_keys: ['frc2'] } } };
    expect(projectMatch(evenMatch, scoutPower).redWinProbability).toBeCloseTo(0.5);
  });

  it('projects nothing when an alliance has no scouted teams at all', () => {
    const unknownMatch = { alliances: { red: { team_keys: ['frc1'] }, blue: { team_keys: ['frc999'] } } };
    expect(projectMatch(unknownMatch, new Map([['frc1', 80]])).redWinProbability).toBeNull();
  });
});

describe('allianceProjectedScore', () => {
  it('sums known teams and omits unscouted ones rather than assuming an average', () => {
    const projectedScores = new Map([
      ['frc1', 40],
      ['frc2', 30]
    ]);
    expect(allianceProjectedScore(['frc1', 'frc2', 'frc3'], projectedScores)).toBe(70);
  });

  it('returns null when no team in the alliance has a projected score', () => {
    expect(allianceProjectedScore(['frc9', 'frc8'], new Map())).toBeNull();
  });
});

describe('isMatchPlayed', () => {
  it('is true only once TBA reports an actual play time', () => {
    expect(isMatchPlayed({ actual_time: 1700000000 })).toBe(true);
    expect(isMatchPlayed({ actual_time: null, winning_alliance: '' })).toBe(false);
  });
});

describe('projectMatch with the EPA model', () => {
  const match = {
    alliances: { red: { team_keys: ['frc1', 'frc2', 'frc3'] }, blue: { team_keys: ['frc4', 'frc5', 'frc6'] } }
  };
  const byTeam = new Map(
    ['frc1', 'frc2', 'frc3', 'frc4', 'frc5', 'frc6'].map((key, index) => [key, { epa: 60 - index * 5 }])
  );

  it('uses EPA points and a calibrated win chance when all six robots are rated', () => {
    const projection = projectMatch(match, new Map(), new Map(), { byTeam, scale: 30 });
    expect(projection.source).toBe('epa');
    expect(projection.redProjectedScore).toBe(60 + 55 + 50);
    expect(projection.blueProjectedScore).toBe(45 + 40 + 35);
    expect(projection.redWinProbability).toBeGreaterThan(0.5);
  });

  it('falls back to Scout Power when a robot has no rating yet', () => {
    const partial = new Map([...byTeam].slice(0, 5));
    const power = new Map(['frc1', 'frc2', 'frc3', 'frc4', 'frc5', 'frc6'].map((key) => [key, 50]));
    const projection = projectMatch(match, power, new Map(), { byTeam: partial, scale: 30 });
    expect(projection.source).toBeUndefined();
    expect(projection.redWinProbability).toBeCloseTo(0.5, 6);
  });
});

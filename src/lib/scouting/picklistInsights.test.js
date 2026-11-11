import { describe, expect, it } from 'vitest';
import { buildPicklistInsights } from './picklistInsights.js';

const strategyRow = (teamKey, overrides = {}) => ({
  teamKey,
  openProblems: [],
  performance: { avgDrivingRank: null },
  matchScoutSummary: { avgDriverSkill: null, timesBroken: 0, matchesScouted: 0, avgBallsScored: null },
  ...overrides
});

const official = [
  { team_key: 'frc254', rank: 1 },
  { team_key: 'frc1678', rank: 2 },
  { team_key: 'frc5940', rank: 3 },
  { team_key: 'frc604', rank: 4 }
];

describe('buildPicklistInsights', () => {
  it('flags the teams ranked above us, best first, and not us or anyone below', () => {
    const result = buildPicklistInsights({
      strategyRows: ['frc5940', 'frc254', 'frc1678', 'frc604'].map((key) => strategyRow(key)),
      officialRankings: official,
      ourTeamKey: 'frc5940'
    });
    expect(result.ourRank).toBe(3);
    expect(result.aboveUs).toEqual(['frc254', 'frc1678']);
    expect(result.byTeam.get('frc254').aboveUs).toBe(true);
    expect(result.byTeam.get('frc5940').aboveUs).toBe(false);
    expect(result.byTeam.get('frc5940').isUs).toBe(true);
    expect(result.byTeam.get('frc604').aboveUs).toBe(false);
  });

  it('highlights nobody when our own official rank is not known yet', () => {
    const result = buildPicklistInsights({
      strategyRows: [strategyRow('frc254')],
      officialRankings: [{ team_key: 'frc254', rank: 1 }],
      ourTeamKey: 'frc5940'
    });
    expect(result.ourRank).toBeNull();
    expect(result.aboveUs).toEqual([]);
    expect(result.byTeam.get('frc254').aboveUs).toBe(false);
  });

  it('highlights nobody when official rankings are unavailable', () => {
    const result = buildPicklistInsights({
      strategyRows: [strategyRow('frc254')],
      officialRankings: [],
      ourTeamKey: 'frc5940'
    });
    expect(result.aboveUs).toEqual([]);
    expect(result.byTeam.get('frc254').officialRank).toBeNull();
  });

  it('carries our scouting data, driver numbers, breakdown count and power rank for each team', () => {
    const result = buildPicklistInsights({
      strategyRows: [
        strategyRow('frc254', {
          openProblems: [{}, {}],
          performance: { avgDrivingRank: 1.5 },
          matchScoutSummary: { avgDriverSkill: 4.2, timesBroken: 3, matchesScouted: 7, avgBallsScored: 18.5 }
        })
      ],
      powerRankings: [{ key: 'frc254', powerRank: 2, scoutPower: 71.3 }],
      officialRankings: official,
      ourTeamKey: 'frc5940'
    });
    expect(result.byTeam.get('frc254')).toMatchObject({
      teamNumber: 254,
      powerRank: 2,
      scoutPower: 71.3,
      driverSkill: 4.2,
      drivingRank: 1.5,
      timesBroken: 3,
      openProblems: 2,
      matchesScouted: 7,
      avgBallsScored: 18.5,
      officialRank: 1
    });
  });

  it('defaults a team with no scouting data to zero broken and no numbers instead of failing', () => {
    const result = buildPicklistInsights({ officialRankings: [{ team_key: 'frc1', rank: 9 }], ourTeamKey: 'frc5940' });
    expect(result.byTeam.get('frc1')).toMatchObject({
      timesBroken: 0,
      matchesScouted: 0,
      driverSkill: null,
      powerRank: null
    });
  });

  it('ignores ranking rows without a usable rank or team', () => {
    const result = buildPicklistInsights({
      officialRankings: [{ team_key: 'frc5940', rank: 5 }, { team_key: 'frc2', rank: 'n/a' }, { rank: 1 }],
      ourTeamKey: 'frc5940'
    });
    expect(result.ourRank).toBe(5);
    expect(result.byTeam.has('frc2')).toBe(false);
  });
});

describe('buildPicklistInsights match-ranking consensus', () => {
  it('shows each team its place in the match-ranking consensus, null when never ranked', () => {
    const { byTeam } = buildPicklistInsights({
      powerRankings: [
        { key: 'frc1', scoutPower: 50, powerRank: 1, humanRank: 2, humanVoteCount: 3 },
        { key: 'frc2', scoutPower: 40, powerRank: 2, humanRank: null, humanVoteCount: 0 }
      ]
    });
    expect(byTeam.get('frc1')).toMatchObject({ matchRank: 2, matchRankVotes: 3 });
    expect(byTeam.get('frc2')).toMatchObject({ matchRank: null, matchRankVotes: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import { averagePowerRankings } from './powerRankingAverages.js';
import { canonicalReports } from '$lib/matches/matchKeys.js';

const entry = (id, match_key, created_by, power_ranking, updated_at = '2026-10-13T10:00:00Z') => ({
  id,
  match_key,
  created_by,
  power_ranking,
  updated_at
});

describe('averagePowerRankings', () => {
  it('averages each robot over only the scouts who ranked it', () => {
    const { matches } = averagePowerRankings([
      entry(1, '2026x_qm1', 'a', { frc1: 1, frc2: 2, frc3: 3 }),
      entry(2, '2026x_qm1', 'b', { frc1: 2, frc2: 1 }),
      entry(3, '2026x_qm1', 'c', { frc1: 1 })
    ]);
    expect(matches).toEqual([
      {
        match_key: '2026x_qm1',
        scouts: 3,
        teams: [
          { team_key: 'frc1', average: 1.33, count: 3 },
          { team_key: 'frc2', average: 1.5, count: 2 },
          { team_key: 'frc3', average: 3, count: 1 }
        ]
      }
    ]);
  });

  it('counts a scout once per match, using their latest report', () => {
    const { matches } = averagePowerRankings([
      entry(1, '2026x_qm2', 'a', { frc1: 3 }, '2026-10-13T10:00:00Z'),
      entry(2, '2026x_qm2', 'a', { frc1: 1 }, '2026-10-13T11:00:00Z')
    ]);
    expect(matches[0]).toMatchObject({ scouts: 1, teams: [{ team_key: 'frc1', average: 1, count: 1 }] });
  });

  it('weights every match equally in the overall average and skips reports with no ranking', () => {
    const { teams, matches } = averagePowerRankings([
      entry(1, '2026x_qm10', 'a', { frc1: 1 }),
      entry(2, '2026x_qm2', 'a', { frc1: 3 }),
      entry(3, '2026x_qm2', 'b', { frc1: 3 }),
      entry(4, '2026x_qm3', 'a', {}),
      { id: 5, match_key: '2026x_qm4', created_by: 'a' }
    ]);
    expect(matches.map((match) => match.match_key)).toEqual(['2026x_qm2', '2026x_qm10']);
    expect(teams).toEqual([{ team_key: 'frc1', average: 2, matches: 2, rankings: 3 }]);
  });

  it('groups scouts who typed the same match differently once keys are canonical', () => {
    const { matches } = averagePowerRankings(
      canonicalReports(
        [entry(1, '3', 'a', { frc1: 1 }), entry(2, 'qm3', 'b', { frc1: 3 }), entry(3, '2026x_qm3', 'c', { frc1: 2 })],
        '2026x'
      )
    );
    expect(matches).toEqual([
      { match_key: '2026x_qm3', scouts: 3, teams: [{ team_key: 'frc1', average: 2, count: 3 }] }
    ]);
  });
});

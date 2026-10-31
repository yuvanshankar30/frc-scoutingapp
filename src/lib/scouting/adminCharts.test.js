import { describe, expect, it } from 'vitest';
import { disagreementsPerScout, reportKindMix, reportsPerScout, robotsReportedPerMatch } from './adminCharts.js';

const r = (id, match, team, scout, extra = {}) => ({
  id,
  match_key: `2026cabl_${match}`,
  team_key: team,
  scout_name: scout,
  report_kind: 'data',
  ...extra
});
const reports = [
  r(1, 'qm2', 'frc5940', 'Ana', { balls_scored_average: 10 }),
  r(2, 'qm2', 'frc5940', 'Ben', { balls_scored_average: 90 }),
  r(3, 'qm2', 'frc254', 'Ana'),
  r(4, 'qm10', 'frc1', 'Ana', { report_kind: 'performance' }),
  r(5, 'qm1', 'frc2', 'Cy', { report_kind: 'robot' })
];

describe('admin charts', () => {
  it('counts robots reported per match in field order', () => {
    expect(robotsReportedPerMatch(reports).map((p) => [p.label, p.value])).toEqual([
      ['Q1', 1],
      ['Q2', 2],
      ['Q10', 1]
    ]);
  });

  it('counts reports per scout, most first', () => {
    expect(reportsPerScout(reports)).toEqual([
      { label: 'Ana', count: 3 },
      { label: 'Ben', count: 1 },
      { label: 'Cy', count: 1 }
    ]);
  });

  it('counts report kinds', () => {
    expect(reportKindMix(reports).map((row) => row.count)).toEqual([3, 1, 1]);
  });

  it('counts strong disagreements per scout', () => {
    expect(disagreementsPerScout(reports)).toEqual([
      { label: 'Ana', count: 1 },
      { label: 'Ben', count: 1 }
    ]);
    expect(disagreementsPerScout([])).toEqual([]);
  });
});

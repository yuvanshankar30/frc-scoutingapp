import { describe, expect, it } from 'vitest';
import { reportKindMix, robotsReportedPerMatch } from './adminCharts.js';

const r = (id, match, team, extra = {}) => ({
  id,
  match_key: `2026cabl_${match}`,
  team_key: team,
  report_kind: 'data',
  ...extra
});
const reports = [
  r(1, 'qm2', 'frc5940'),
  r(2, 'qm2', 'frc5940'),
  r(3, 'qm2', 'frc254'),
  r(4, 'qm10', 'frc1', { report_kind: 'performance' }),
  r(5, 'qm1', 'frc2', { report_kind: 'robot' })
];

describe('admin charts', () => {
  it('counts robots reported per match in field order', () => {
    expect(robotsReportedPerMatch(reports).map((p) => [p.label, p.value])).toEqual([
      ['Q1', 1],
      ['Q2', 2],
      ['Q10', 1]
    ]);
  });

  it('counts report kinds', () => {
    expect(reportKindMix(reports).map((row) => row.count)).toEqual([3, 1, 1]);
  });
});

import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import MatchScoutReport from './MatchScoutReport.svelte';

const base = { match_key: '2026cc_qm4', team_key: 'frc6036', form_version: 2, created_at: '2026-09-19T18:00:00Z' };

describe('MatchScoutReport', () => {
  it('shows a Performance report its own sections, not the Data ones', () => {
    const report = {
      ...base,
      report_kind: 'performance',
      scout_name: 'Priya',
      ratings: { 'Shot accuracy': 4, BPS: 3 },
      power_ranking: { frc5940: 2, frc254: 1 }
    };
    const { body } = render(MatchScoutReport, { props: { report, bodyOnly: true } });
    expect(body).toContain('Power ranking');
    expect(body).toContain('1. 254');
    expect(body).not.toContain('Autonomous');
  });

  it('shows a Robot report its condition, not the Performance ratings', () => {
    const report = { ...base, report_kind: 'robot', scout_name: 'Sam', teleop_robot_status: 'active' };
    const { body } = render(MatchScoutReport, { props: { report, bodyOnly: true } });
    expect(body).toContain('Condition');
    expect(body).not.toContain('Power ranking');
  });

  it('previews a long written answer and offers to open it in full', () => {
    const long = 'The intake jammed twice. '.repeat(20);
    const short = { ...base, report_kind: 'data', scout_name: 'Clara', teleop_notes: 'Fast cycles.' };
    const longReport = { ...short, teleop_notes: long };
    expect(render(MatchScoutReport, { props: { report: short, bodyOnly: true } }).body).not.toContain(
      'Read full answer'
    );
    expect(render(MatchScoutReport, { props: { report: longReport, bodyOnly: true } }).body).toContain(
      'Read full answer'
    );
  });
});

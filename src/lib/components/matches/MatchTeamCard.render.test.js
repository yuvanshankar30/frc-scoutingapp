import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import MatchTeamCard from './MatchTeamCard.svelte';

const base = { match_key: '2026cc_qm4', team_key: 'frc6036', form_version: 2, created_at: '2026-09-19T18:00:00Z' };

describe('MatchTeamCard', () => {
  it('shows the Data line, the Performance ratings and the Robot incidents, each from its own report, with a button per kind', () => {
    const reports = [
      { ...base, id: 1, report_kind: 'data', scout_name: 'Clara', balls_scored_band: '50-75', auto_points_average: 11 },
      { ...base, id: 2, report_kind: 'performance', scout_name: 'Priya', ratings: { 'Shot accuracy': 4, BPS: 3 } },
      { ...base, id: 3, report_kind: 'robot', scout_name: 'Sam', teleop_robot_status: 'active', auto_collision: true }
    ];
    const { body } = render(MatchTeamCard, { props: { teamKey: 'frc6036', reports } });
    expect(body).toContain('50-75');
    expect(body).toContain('Performance ratings');
    expect(body).toContain('Priya');
    expect(body).toContain('4/5');
    expect(body).toContain('Auto collision');
    expect(body).toContain('View data scouting report');
    expect(body).toContain('View performance scouting report');
    expect(body).toContain('View robot scouting report');
  });

  it('says a Robot report found nothing, and only offers buttons for kinds that were filed', () => {
    const reports = [{ ...base, id: 3, report_kind: 'robot', scout_name: 'Sam', teleop_robot_status: 'active' }];
    const { body } = render(MatchTeamCard, { props: { teamKey: 'frc6036', reports } });
    expect(body).toContain('None reported.');
    expect(body).toContain('View robot scouting report');
    expect(body).not.toContain('View performance scouting report');
  });
});

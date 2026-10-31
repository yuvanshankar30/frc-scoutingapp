import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ScoutAccuracy from './ScoutAccuracy.svelte';

const match = {
  key: '2026tst_qm1',
  comp_level: 'qm',
  match_number: 1,
  alliances: {
    red: { team_keys: ['frc1', 'frc2', 'frc3'], score: 120 },
    blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: 60 }
  },
  score_breakdown: {
    red: { hubScore: { totalCount: 100 }, totalAutoPoints: 20, minorFoulCount: 0, majorFoulCount: 0 },
    blue: { hubScore: { totalCount: 50 }, totalAutoPoints: 10, minorFoulCount: 0, majorFoulCount: 0 }
  }
};
const entry = (team, balls) => ({
  match_key: '2026tst_qm1',
  team_key: team,
  report_kind: 'data',
  scout_name: 'Sam',
  balls_scored_average: balls,
  auto_points_average: 5
});

describe('ScoutAccuracy', () => {
  it('shows how much of TBA fuel the scouts counted, per alliance and per scout', () => {
    const entries = [entry('frc1', 30), entry('frc2', 30), entry('frc3', 20)];
    const { body } = render(ScoutAccuracy, { props: { matches: [match], entries } });
    expect(body).toContain('Scout accuracy');
    expect(body).toContain('80%');
    expect(body).toContain('By alliance');
    expect(body).toContain('By scout');
    expect(body).toContain('Sam');
  });

  it('says so when no match has official results yet', () => {
    const { body } = render(ScoutAccuracy, { props: { matches: [], entries: [] } });
    expect(body).toContain('No played matches with official results yet.');
  });
});

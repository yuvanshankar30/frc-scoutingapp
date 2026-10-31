import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import AdminModelsPanel from './AdminModelsPanel.svelte';
import PitProblemsView from './PitProblemsView.svelte';

describe('PitProblemsView', () => {
  const problems = [
    {
      id: 1,
      team_key: 'frc5940',
      severity: 'urgent',
      source: 'Match scout',
      match_key: '2026cc_qm4',
      summary: 'Intake belt slipping',
      detail: 'Check tension',
      resolved: false
    },
    { id: 2, team_key: 'frc254', severity: 'watch', summary: 'Loose bumper', resolved: true }
  ];

  it('lists open problems, folds resolved ones away and shows the add form', () => {
    const { body } = render(PitProblemsView, {
      props: { problems, teams: ['frc5940', 'frc254'], eventLabel: '2026cc' }
    });
    expect(body).toContain('Problems reported by match and pit scouts for 2026cc.');
    expect(body).toContain('Team 5940');
    expect(body).toContain('Intake belt slipping');
    expect(body).toContain('Qual 4');
    expect(body).toContain('Resolved problems (1)');
    expect(body).toContain('Add a pit report');
  });

  it('says when nothing is open and blocks adding on a past event', () => {
    const { body } = render(PitProblemsView, { props: { problems: [], readOnly: true } });
    expect(body).toContain('No pit problems reported for this event.');
    expect(body).toContain('Switch to the current event before adding a problem.');
  });
});

describe('AdminModelsPanel', () => {
  it('shows the fuel calibration and Quick Scout attribution tables', () => {
    const { body } = render(AdminModelsPanel, {
      props: {
        smartFuelModel: {
          enabled: true,
          match_count: 12,
          by_scout: [{ scout_name: 'Riley', adjustment_factor: 1.1, sample_matches: 4 }]
        },
        quickScoutModel: {
          alliance_count: 3,
          by_team: [
            { team_key: 'frc5940', avg_percent_of_alliance_score: 40, avg_contribution_points: 30, matches_scored: 3 }
          ],
          coefficients: null
        }
      }
    });
    expect(body).toContain('Disable Algorithm');
    expect(body).toContain('Riley');
    expect(body).toContain('Quick Scouting Alliance Attribution');
    expect(body).toContain('>5940<');
  });
});

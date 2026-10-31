import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import StrategyTeamBrief from './StrategyTeamBrief.svelte';
import { teamStats } from '$lib/scouting/strategyBoard.js';

const entries = [
  {
    id: 1,
    match_key: '2026tst_qm1',
    team_key: 'frc5940',
    report_kind: 'data',
    scout_name: 'Sam',
    balls_scored_average: 40,
    teleop_roles: ['Scorer']
  },
  {
    id: 2,
    match_key: '2026tst_qm1',
    team_key: 'frc5940',
    report_kind: 'performance',
    scout_name: 'Ana',
    ratings: { 'Shot accuracy': 4, BPS: 3 }
  },
  {
    id: 3,
    match_key: '2026tst_qm1',
    team_key: 'frc5940',
    report_kind: 'robot',
    scout_name: 'Rae',
    teleop_robot_status: 'active'
  }
];
const row = {
  teamKey: 'frc5940',
  teamNumber: '5940',
  matchEntries: entries,
  openProblems: [{ severity: 'urgent', summary: 'Loose intake chain' }],
  notes: [],
  autoPaths: [],
  pitEntry: { robot_archetype: 'Fast shooter', drivebase_type: 'Swerve', climb_options: ['L1', 'L2'] },
  matchScoutSummary: {
    avgBallsScored: 40,
    ratingAverages: { 'Shot accuracy': 4, BPS: 3 },
    matchesScouted: 1,
    roleCounts: { Scorer: 1 }
  },
  autoAverage: 12
};

describe('StrategyTeamBrief', () => {
  it('shows the team, its numbers, its matches, pit profile, issues and reports by kind', () => {
    const stats = teamStats(row, {
      epaRow: { epa: 150, components: { auto: 30, teleop: 115, endgame: 5 } },
      epaRank: 1
    });
    const timeline = [
      {
        matchKey: '2026tst_qm1',
        label: 'Q1',
        side: 'red',
        played: true,
        score: 100,
        opponentScore: 80,
        result: 'win',
        points: 52,
        incident: false,
        noShow: false
      }
    ];
    const { body } = render(StrategyTeamBrief, {
      props: { row, stats, name: 'Gearheads', timeline, teamCount: 40, teamHref: '/teamview?team=frc5940' }
    });
    for (const text of [
      'Gearheads',
      'EPA',
      '150.0',
      'Match by match',
      'Q1',
      'Swerve',
      'L1, L2',
      'Loose intake chain',
      'Data',
      'Performance',
      'Robot',
      'Scorer',
      '#1 of 40'
    ])
      expect(body).toContain(text);
  });

  it('says what is missing instead of showing empty boxes', () => {
    const bare = {
      ...row,
      matchEntries: [],
      openProblems: [],
      pitEntry: null,
      matchScoutSummary: { ratingAverages: {}, matchesScouted: 0 }
    };
    const { body } = render(StrategyTeamBrief, { props: { row: bare, stats: teamStats(bare), timeline: [] } });
    expect(body).toContain('No pit profile yet.');
    expect(body).toContain('No matches on the schedule yet.');
    expect(body).toContain('No Data reports for this team yet.');
  });
});

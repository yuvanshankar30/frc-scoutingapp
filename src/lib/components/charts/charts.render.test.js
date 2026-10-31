import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import BoxCompare from './BoxCompare.svelte';
import CountBars from './CountBars.svelte';
import LineChart from './LineChart.svelte';
import PercentileBars from './PercentileBars.svelte';
import StatusStrip from './StatusStrip.svelte';
import TeamChartsPanel from '../scouting/TeamChartsPanel.svelte';
import TeamGrid from '../scouting/TeamGrid.svelte';

const point = (match, value) => ({ matchKey: `2026cabl_${match}`, label: match.toUpperCase(), value });

describe('LineChart', () => {
  it('draws one segment per run of reported matches, leaving a gap for an unscouted one', () => {
    const { body } = render(LineChart, {
      props: {
        series: [
          {
            name: 'Balls',
            color: 'blue',
            points: [point('qm1', 10), point('qm2', 12), point('qm3', null), point('qm4', 8)]
          }
        ]
      }
    });
    expect(body.match(/<polyline/g)).toHaveLength(1);
    expect(body.match(/<circle/g)).toHaveLength(3);
    expect(body).toContain('Balls');
  });

  it('says so when there is nothing to draw', () => {
    const { body } = render(LineChart, {
      props: { series: [{ name: 'Balls', color: 'blue', points: [point('qm1', null)] }] }
    });
    expect(body).toContain('No scouting data for this yet.');
  });

  it('writes out the reference line value', () => {
    const { body } = render(LineChart, {
      props: {
        series: [{ name: 'Balls', color: 'blue', points: [point('qm1', 10)] }],
        reference: { value: 7.25, label: 'Event avg' }
      }
    });
    expect(body).toContain('Event avg: 7.3');
  });
});

describe('summary charts', () => {
  it('renders percentiles, counts, boxes and the condition strip with their numbers visible', () => {
    expect(
      render(PercentileBars, {
        props: {
          rows: [
            {
              metric: 'ballsScored',
              label: 'Teleop balls',
              unit: '',
              value: 30,
              eventMean: 20,
              percentile: 80,
              teams: 30
            }
          ]
        }
      }).body
    ).toContain('event avg 20');
    expect(
      render(CountBars, {
        props: {
          rows: [
            { label: 'Scorer', count: 3 },
            { label: 'Defense', count: 1 }
          ]
        }
      }).body
    ).toContain('75%');
    expect(
      render(BoxCompare, {
        props: { team: { min: 1, q1: 2, median: 3, q3: 4, max: 5, count: 5 }, event: null }
      }).body.replace(/<!--[^>]*-->/g, '')
    ).toMatch(/median <b[^>]*>3<\/b>/);
    expect(
      render(StatusStrip, {
        props: {
          rows: [
            { matchKey: 'a', label: 'Q1', status: 'ok' },
            { matchKey: 'b', label: 'Q2', status: 'broke' },
            { matchKey: 'c', label: 'Q3', status: null }
          ]
        }
      }).body
    ).toContain('Broke in 1 of 2 reported matches.');
  });
});

describe('Team View panels', () => {
  const entries = [
    {
      team_key: 'frc5940',
      match_key: '2026cabl_qm1',
      report_kind: 'data',
      form_version: 2,
      balls_scored_average: 20,
      auto_points_average: 10,
      teleop_roles: ['Scorer']
    },
    { team_key: 'frc254', match_key: '2026cabl_qm1', report_kind: 'data', form_version: 2, balls_scored_average: 40 }
  ];

  it('renders the chart panel for a team with reports', () => {
    const { body } = render(TeamChartsPanel, { props: { teamKey: 'frc5940', allEntries: entries, matches: [] } });
    expect(body).toContain('From 1 match report on this team');
    expect(body).toContain('Scoring per match');
  });

  it('renders a card per team with a link and stats', () => {
    const rows = [
      {
        key: 'frc5940',
        number: 5940,
        name: 'Gearheads',
        rank: 2,
        record: '5-1-0',
        opr: 41.5,
        avgBalls: 20,
        avgAuto: 10,
        scouted: 1,
        played: 2,
        coverage: 0.5,
        pitScouted: true
      }
    ];
    const { body } = render(TeamGrid, { props: { rows, eventKey: '2026cabl' } });
    expect(body).toContain('Gearheads');
    expect(body).toContain('href="/teamview?team=5940"');
    expect(body).toContain('Scouted 1 of 2 played · pit done');
  });
});

import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import BoxCompare from './BoxCompare.svelte';
import CountBars from './CountBars.svelte';
import LineChart from './LineChart.svelte';
import PercentileBars from './PercentileBars.svelte';
import RankedBars, { rowKey } from './RankedBars.svelte';
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

describe('RankedBars', () => {
  const rows = [
    { label: '254', href: '/teamview?team=254', value: 12, n: 2, faded: true },
    { label: '5940', href: '/teamview?team=5940', value: 30.25, n: 8 }
  ];

  it('ranks highest first and writes out each value and n', () => {
    const { body } = render(RankedBars, { props: { rows, digits: 1 } });
    expect(body.indexOf('5940')).toBeLessThan(body.indexOf('254'));
    expect(body).toContain('30.3');
    expect(body).toContain('n = 8');
    expect(body).toContain('href="/teamview?team=5940"');
  });

  it('marks small-sample rows as faded', () => {
    const { body } = render(RankedBars, { props: { rows } });
    expect(body.match(/class="[^"]*faded/g)).toHaveLength(1);
  });

  it('draws negative values on the left of a centre line when signed', () => {
    const { body } = render(RankedBars, {
      props: {
        rows: [
          { label: '1', value: -5, n: 6 },
          { label: '2', value: 10, n: 6 }
        ],
        signed: true
      }
    });
    expect(body).toContain('negative');
    expect(body).toContain('−5');
  });

  it('shows the empty text with no rows', () => {
    const { body } = render(RankedBars, { props: { rows: [], emptyText: 'Nothing scouted yet.' } });
    expect(body).toContain('Nothing scouted yet.');
  });
});

describe('RankedBars lower-is-better', () => {
  it('ranks the lowest value first when lowerIsBetter is set', () => {
    const { body } = render(RankedBars, {
      props: {
        rows: [
          { label: 'AAA', value: 1, n: 5 },
          { label: 'BBB', value: 9, n: 5 }
        ],
        lowerIsBetter: true
      }
    });
    expect(body.indexOf('AAA')).toBeLessThan(body.indexOf('BBB'));
  });

  it('colours a fall as good and a rise as bad for a lower-is-better change', () => {
    const { body } = render(RankedBars, {
      props: {
        rows: [{ label: 'AAA', value: -3, n: 6 }],
        signed: true,
        lowerIsBetter: true,
        color: 'GOOD',
        negativeColor: 'BAD'
      }
    });
    expect(body).toContain('background:GOOD');
    expect(body).not.toContain('background:BAD');
  });
});

describe('Rankings tap targets', () => {
  it('gives RankedBars team links and the trend chips a phone tap target of --tap-min', () => {
    const bars = readFileSync('src/lib/components/charts/RankedBars.svelte', 'utf8');
    const page = readFileSync('src/routes/dataviewer/rankings/+page.svelte', 'utf8');
    expect(bars).toMatch(/\.label a\s*\{[^}]*min-height:\s*var\(--tap-min\)/);
    expect(page).toMatch(/\.phone \.chip\s*\{[^}]*min-height:\s*var\(--tap-min\)/);
  });
});

describe('RankedBars layout', () => {
  it('draws a negative change left of the centre line at half width for the largest value', () => {
    const { body } = render(RankedBars, {
      props: {
        rows: [
          { label: 'A', value: -10, n: 6 },
          { label: 'B', value: 5, n: 6 }
        ],
        signed: true
      }
    });
    expect(body).toMatch(/width:50%;[^"]*right:50%/);
    expect(body).toMatch(/width:25%;[^"]*left:50%/);
  });

  it('keys rows by their key, falling back to position + label so repeated labels never collide', () => {
    expect(rowKey({ key: 'frc5940', label: '5940' }, 0)).toBe('frc5940');
    expect(rowKey({ label: 'X' }, 0)).not.toBe(rowKey({ label: 'X' }, 1));
  });

  it('writes a change that rounds to zero without a sign', () => {
    const { body } = render(RankedBars, {
      props: {
        rows: [
          { label: 'A', value: 0.01, n: 6 },
          { label: 'B', value: -0.01, n: 6 }
        ],
        signed: true
      }
    });
    expect(body).not.toContain('+0.0');
    expect(body).not.toContain('−0.0');
  });
});

// Presence checks on the page source: they confirm the page uses the tested helpers (the behaviour itself is tested
// in dataPage.test.js), not that the page behaves correctly end to end.
describe('Rankings wiring (source presence checks)', () => {
  const page = readFileSync('src/routes/dataviewer/rankings/+page.svelte', 'utf8');
  it('reads the scouting the Data Viewer layout loaded instead of fetching its own, and titles any metric', () => {
    expect(page).toContain('useDataViewer()');
    expect(page).not.toContain('fetch(');
    expect(page).toContain('Top teams:');
  });

  it('matches team keys through the shared helpers', () => {
    expect(page).toContain('teamRows(entries, teamKey)');
    expect(page).not.toMatch(/toLowerCase\(\) === teamKey/);
  });

  it('tells screen readers a chip is not drawn and keeps ratings on 0-5', () => {
    expect(page).toMatch(/aria-label=\{`Remove \$\{[^`]*not drawn/);
    expect(page).toContain('max={chartMax(metric)}');
  });

  it('only offers "Add a team" when the picker is there, and never spends a line on a team without data', () => {
    expect(page).toContain('available: top.rows.map');
    expect(page).toMatch(/\{#if teamOptions\.length && lines\.canAdd\}\s*Add a team/);
  });
});

describe('RankedBars units', () => {
  it('writes /5 against the number and word units after a space, like the rest of the page', () => {
    const rating = render(RankedBars, { props: { rows: [{ label: 'A', value: 3.5, n: 4 }], unit: '/5' } }).body;
    expect(rating).toContain('3.5/5');
    expect(rating).not.toContain('3.5 /5');
    const balls = render(RankedBars, { props: { rows: [{ label: 'A', value: 12.5, n: 4 }], unit: 'balls' } }).body;
    expect(balls).toContain('12.5 balls');
  });

  it('gives the Coverage links a phone tap target', () => {
    const page = readFileSync('src/routes/dataviewer/rankings/+page.svelte', 'utf8');
    expect(page).toMatch(/\.phone \.links a\s*\{[^}]*min-height:\s*var\(--tap-min\)/);
  });
});

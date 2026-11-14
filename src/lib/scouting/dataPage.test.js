import { describe, expect, it } from 'vitest';
import {
  MIN_MATCHES,
  chartMax,
  isMetric,
  readoutUnit,
  teamRows,
  topScorerRows,
  trendLines,
  trendRows
} from './dataPage.js';

const report = (team, match, balls) => ({
  team_key: team,
  match_key: `2026cabl_${match}`,
  report_kind: 'data',
  form_version: 2,
  balls_scored_average: balls
});
const teams = [
  { key: 'frc5940', team_number: 5940, nickname: 'Test Team' },
  { key: 'frc254', team_number: 254, nickname: 'The Cheesy Poofs' },
  { key: 'frc1678', team_number: 1678, nickname: 'Citrus Circuits' }
];

describe('topScorerRows', () => {
  const entries = [
    report('frc5940', 'qm1', 30),
    report('frc5940', 'qm2', 40),
    report('frc5940', 'qm3', 50),
    report('frc254', 'qm1', 60)
  ];

  it('gives each scouted team its mean, n and a Team View link, fading teams under the minimum', () => {
    const { rows } = topScorerRows({ entries, metric: 'ballsScored', teams, eventKey: '2026cabl' });
    const by = new Map(rows.map((row) => [row.label, row]));
    expect(by.get('5940')).toMatchObject({ value: 40, n: 3, faded: false });
    expect(by.get('254')).toMatchObject({ value: 60, n: 1, faded: true });
    expect(by.get('5940').href).toBe(
      '/teamview?event_key=2026cabl&team=frc5940&from=%2Fdataviewer%2Frankings&fromLabel=Rankings'
    );
    expect(MIN_MATCHES).toBe(3);
  });

  it('lists event teams with no scouting as not scouted instead of drawing them at 0', () => {
    const { rows, notScouted } = topScorerRows({ entries, metric: 'ballsScored', teams, eventKey: '2026cabl' });
    expect(rows.map((row) => row.label)).not.toContain('1678');
    expect(notScouted).toEqual(['1678']);
  });
});

describe('trendRows', () => {
  const six = (team, values) => values.map((value, i) => report(team, `qm${i + 1}`, value));

  it('ranks teams by late minus early and lists teams without enough matches separately', () => {
    const entries = [...six('frc5940', [10, 10, 10, 40, 40, 40]), report('frc254', 'qm1', 5)];
    const { rows, notEnough, improvers } = trendRows({ entries, metric: 'ballsScored', eventKey: '2026cabl' });
    expect(rows).toEqual([expect.objectContaining({ label: '5940', value: 30, n: 6 })]);
    expect(notEnough).toEqual(['254']);
    expect(improvers).toEqual(['frc5940']);
  });

  it('only counts teams that improved as improvers, at most three', () => {
    const entries = [
      ...six('frc5940', [40, 40, 40, 10, 10, 10]),
      ...six('frc254', [1, 1, 1, 2, 2, 2]),
      ...six('frc1678', [1, 1, 1, 9, 9, 9])
    ];
    const { improvers } = trendRows({ entries, metric: 'ballsScored', eventKey: '2026cabl' });
    expect(improvers).toEqual(['frc1678', 'frc254']);
  });
});

describe('lower-is-better metrics (fouls)', () => {
  const foul = (team, match, minor) => ({
    team_key: team,
    match_key: `2026cabl_${match}`,
    report_kind: 'robot',
    form_version: 2,
    fouls_minor: minor
  });

  it('flags the rows so the chart ranks fewest first', () => {
    const { lowerIsBetter } = topScorerRows({
      entries: [foul('frc5940', 'qm1', 1)],
      metric: 'fouls',
      teams,
      eventKey: 'e'
    });
    expect(lowerIsBetter).toBe(true);
    expect(topScorerRows({ entries: [], metric: 'ballsScored', teams, eventKey: 'e' }).lowerIsBetter).toBe(false);
  });

  it('counts a team whose fouls went down as improving, not one whose fouls went up', () => {
    const six = (team, values) => values.map((value, i) => foul(team, `qm${i + 1}`, value));
    const entries = [...six('frc5940', [5, 5, 5, 1, 1, 1]), ...six('frc254', [1, 1, 1, 5, 5, 5])];
    const { improvers, lowerIsBetter } = trendRows({ entries, metric: 'fouls', eventKey: 'e' });
    expect(lowerIsBetter).toBe(true);
    expect(improvers).toEqual(['frc5940']);
  });
});

describe('not scouted', () => {
  it('lists only teams with no reports at all, and teams with reports but no value for this metric separately', () => {
    const entries = [
      report('frc5940', 'qm1', 30),
      { team_key: 'frc254', match_key: '2026cabl_qm1', report_kind: 'robot', form_version: 2 }
    ];
    const { notScouted, noData } = topScorerRows({ entries, metric: 'ballsScored', teams, eventKey: 'e' });
    expect(notScouted).toEqual(['1678']);
    expect(noData).toEqual(['254']);
  });
});

describe('trendLines', () => {
  it('draws improvers first, then picked teams, up to the cap, and never repeats a team', () => {
    const lines = trendLines({ improvers: ['frc1', 'frc2'], picked: ['frc2', 'frc3', 'frc4'], max: 3 });
    expect(lines.drawn).toEqual(['frc1', 'frc2', 'frc3']);
    expect(lines.canAdd).toBe(false);
  });

  it('keeps a chip for every picked team that is not an improver, marking ones past the cap as not drawn', () => {
    const lines = trendLines({ improvers: ['frc1', 'frc2'], picked: ['frc2', 'frc3', 'frc4'], max: 3 });
    expect(lines.chips).toEqual([
      { key: 'frc3', drawn: true },
      { key: 'frc4', drawn: false }
    ]);
  });

  it('allows adding while under the cap', () => {
    expect(trendLines({ improvers: ['frc1'], picked: ['frc5'], max: 5 }).canAdd).toBe(true);
  });
});

describe('team keys', () => {
  it('treats frc05940 and frc5940 as one team everywhere', () => {
    const entries = [report('frc05940', 'qm1', 30), report('frc5940', 'qm2', 50)];
    const { rows, noData, notScouted } = topScorerRows({ entries, metric: 'ballsScored', teams, eventKey: 'e' });
    expect(rows.map((row) => row.teamKey)).toEqual(['frc5940']);
    expect(rows[0].n).toBe(2);
    expect(noData).toEqual([]);
    expect(notScouted).not.toContain('5940');
    expect(teamRows(entries, 'frc5940')).toHaveLength(2);
  });

  it('gives every row a stable key so the chart can track it', () => {
    const { rows } = topScorerRows({
      entries: [report('frc5940', 'qm1', 30)],
      metric: 'ballsScored',
      teams,
      eventKey: 'e'
    });
    expect(rows[0].key).toBe('frc5940');
  });
});

describe('trend noise', () => {
  it('treats a floating-point-only change as no change, so the team is not an improver', () => {
    const entries = [0.3, 0.2, 0.1, 0.1, 0.2, 0.3].map((value, i) => report('frc5940', `qm${i + 1}`, value));
    const { rows, improvers } = trendRows({ entries, metric: 'ballsScored', eventKey: 'e' });
    expect(rows[0].value).toBe(0);
    expect(improvers).toEqual([]);
  });
});

describe('links and scales', () => {
  it('fixes rating charts at 0-5 like Team View and leaves other metrics to their data', () => {
    expect(chartMax('accuracy')).toBe(5);
    expect(chartMax('ballsScored')).toBeNull();
  });
});

describe('improver cap', () => {
  it('returns at most three improvers, biggest gain first', () => {
    const six = (team, late) => [1, 1, 1, late, late, late].map((value, i) => report(team, `qm${i + 1}`, value));
    const entries = [...six('frc1', 2), ...six('frc2', 5), ...six('frc3', 4), ...six('frc4', 3)];
    expect(trendRows({ entries, metric: 'ballsScored', eventKey: 'e' }).improvers).toEqual(['frc2', 'frc3', 'frc4']);
  });
});

describe('readoutUnit', () => {
  it('puts a space before word units and none before a /5 scale', () => {
    expect(readoutUnit('balls')).toBe(' balls');
    expect(readoutUnit('/5')).toBe('/5');
    expect(readoutUnit('')).toBe('');
  });
});

describe('round 3', () => {
  it('links back to the exact Rankings view, so "Back to Rankings" keeps the event and metric', () => {
    const from = '/dataviewer/rankings?event_key=2026old&metric=fouls';
    const { rows } = topScorerRows({
      entries: [report('frc5940', 'qm1', 3)],
      metric: 'ballsScored',
      teams,
      eventKey: '2026old',
      from
    });
    expect(new URL(rows[0].href, 'http://x').searchParams.get('from')).toBe(from);
    const trend = trendRows({
      entries: [1, 1, 1, 2, 2, 2].map((v, i) => report('frc5940', `qm${i + 1}`, v)),
      metric: 'ballsScored',
      eventKey: '2026old',
      from
    });
    expect(new URL(trend.rows[0].href, 'http://x').searchParams.get('from')).toBe(from);
  });

  it('does not spend a line slot on a picked team with no data for the metric, and marks its chip not drawn', () => {
    const lines = trendLines({ improvers: [], picked: ['frc1', 'frc2'], max: 5, available: ['frc2'] });
    expect(lines.drawn).toEqual(['frc2']);
    expect(lines.chips).toEqual([
      { key: 'frc1', drawn: false },
      { key: 'frc2', drawn: true }
    ]);
  });
});

describe('metric names from the URL', () => {
  it('rejects names inherited from Object.prototype', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(isMetric(name)).toBe(false);
    }
    expect(isMetric('fouls')).toBe(true);
  });
});

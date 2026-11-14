import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FieldCard from './FieldCard.svelte';
import FieldDetails from './FieldDetails.svelte';
import TeamBars from '../charts/TeamBars.svelte';
import { summarizeField } from '$lib/scouting/dataViewer.js';
import { BUILT_IN_FIELDS } from '$lib/scouting/dataViewerFields.js';

const field = (id) => BUILT_IN_FIELDS.match.find((entry) => entry.id === id);
const report = (team, match, extra) => ({
  id: `${team}-${match}`,
  team_key: `frc${team}`,
  match_key: `2026cc_${match}`,
  report_kind: 'data',
  form_version: 2,
  scout_name: 'Scout A',
  ...extra
});
const records = [
  report(5940, 'qm1', { balls_scored_average: 40, teleop_notes: 'Fast cycles' }),
  report(5940, 'qm2', { balls_scored_average: 60 }),
  report(254, 'qm1', { balls_scored_average: 80 })
];
const strip = (html) => html.replace(/<!--[^>]*-->/g, '').replace(/\s+/g, ' ');

describe('TeamBars', () => {
  it('draws a bar per team and a range line only when a team has a spread', () => {
    const { body } = render(TeamBars, {
      props: {
        rows: [
          { key: 'a', label: '5940', value: 50, min: 40, max: 60, text: '50' },
          { key: 'b', label: '254', value: 80, min: 80, max: 80, text: '80' }
        ]
      }
    });
    expect(body.match(/class="fill/g)).toHaveLength(2);
    expect(body.match(/class="range/g)).toHaveLength(1);
  });

  it('cuts the list to the limit', () => {
    const rows = [1, 2, 3].map((n) => ({ key: `k${n}`, label: `${n}`, value: n, text: `${n}` }));
    const { body } = render(TeamBars, { props: { rows, limit: 2 } });
    expect(body.match(/<li/g)).toHaveLength(2);
  });
});

describe('FieldCard', () => {
  const card = (id, extra = {}) =>
    render(FieldCard, {
      props: { summary: summarizeField(field(id), records), href: `/dataviewer/field/match/${id}`, ...extra }
    }).body;

  it('is one link to the field page, with its headline and up to three team bars', () => {
    const body = card('balls_scored');
    const text = strip(body);
    expect(body).toMatch(/<a[^>]*href="\/dataviewer\/field\/match\/balls_scored"/);
    expect(text).toContain('Balls scored (estimate)');
    expect(text).toContain('avg 60 · 40–80');
    expect(text).toContain('3 reports · 2 teams');
    expect(body.match(/class="fill/g)).toHaveLength(2);
  });

  it('quotes the latest written answer instead of drawing a chart', () => {
    const body = card('teleop_notes');
    expect(body).toContain('Fast cycles');
    expect(body).not.toContain('class="fill');
  });

  it('says a field nobody answered is not scouted yet', () => {
    expect(card('auto_cycles')).toContain('Not scouted yet');
  });
});

describe('FieldDetails', () => {
  it('shows a per-team table with averages on desktop', () => {
    const { body } = render(FieldDetails, { props: { summary: summarizeField(field('balls_scored'), records) } });
    const text = strip(body);
    expect(body).toContain('<table');
    expect(text).toContain('Average');
    expect(text).toContain('5940');
  });

  it('uses cards, not tables, on phones', () => {
    const { body } = render(FieldDetails, {
      props: { summary: summarizeField(field('balls_scored'), records), phone: true }
    });
    expect(body).not.toContain('<table');
    expect(strip(body)).toContain('avg');
  });
});

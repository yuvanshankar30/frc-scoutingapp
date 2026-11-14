import { describe, expect, it } from 'vitest';
import {
  answerCounts,
  barScale,
  chartKind,
  emptyFilters,
  fieldTrend,
  entryList,
  entrySections,
  filterFields,
  filterRecords,
  formatNumber,
  groupBySection,
  headline,
  lastQualNumber,
  matchType,
  neighbors,
  recordId,
  summarizeField,
  teamBarRows,
  teamOptions,
  viewToCsv
} from './dataViewer.js';
import {
  BUILT_IN_FIELDS,
  customField,
  displayValue,
  fieldApplies,
  fieldsFor,
  formSections,
  readField
} from './dataViewerFields.js';

const field = (form, id) => BUILT_IN_FIELDS[form].find((entry) => entry.id === id);

const data = (team, match, extra = {}) => ({
  id: `${team}-${match}-data`,
  team_key: `frc${team}`,
  match_key: `2026cc_${match}`,
  report_kind: 'data',
  form_version: 2,
  scout_name: 'Scout A',
  ...extra
});

describe('data viewer field catalog', () => {
  it('lists every match section and pit section with at least one field', () => {
    for (const form of ['match', 'pit']) {
      const sections = new Set(BUILT_IN_FIELDS[form].map((entry) => entry.section));
      for (const section of formSections(form)) expect(sections.has(section.id), section.id).toBe(true);
    }
  });

  it('gives every field a unique id, a label and a known type', () => {
    for (const form of ['match', 'pit']) {
      const ids = BUILT_IN_FIELDS[form].map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const entry of BUILT_IN_FIELDS[form]) {
        expect(entry.label).toBeTruthy();
        expect(['number', 'rating', 'yesno', 'choice', 'multi', 'text']).toContain(entry.type);
        expect(entry.sectionLabel).toBeTruthy();
      }
    }
  });

  it('does not read Robot answers from a Data report, but does from an older combined report', () => {
    const crash = field('match', 'significant_crash');
    expect(fieldApplies(crash, data(5940, 'qm1', { significant_crash: false }))).toBe(false);
    expect(readField(crash, data(5940, 'qm1', { significant_crash: false }))).toBe(null);
    expect(readField(crash, { team_key: 'frc5940', significant_crash: true, form_version: 1 })).toBe('Yes');
    expect(readField(crash, data(5940, 'qm1', { report_kind: 'robot', significant_crash: true }))).toBe('Yes');
  });

  it('reads blanks as not answered, never as 0', () => {
    const balls = field('match', 'balls_scored');
    expect(readField(balls, data(5940, 'qm1', { balls_scored_average: null }))).toBe(null);
    expect(readField(balls, data(5940, 'qm1', { balls_scored_average: '' }))).toBe(null);
    expect(readField(balls, data(5940, 'qm1', { balls_scored_average: 0 }))).toBe(0);
  });

  it('shows the range a scout entered next to the estimate', () => {
    const balls = field('match', 'balls_scored');
    expect(displayValue(balls, data(5940, 'qm1', { balls_scored_average: 50, balls_scored_band: '40-60' }))).toBe(
      '40-60'
    );
  });

  it('reads pit technical details', () => {
    const swerve = field('pit', 'tech_swerve_module');
    const motors = field('pit', 'tech_motor_types');
    const reliability = field('pit', 'tech_overall_reliability_rating');
    const pit = {
      team_key: 'frc5940',
      technical_details: { motor_types: ['x60', 'Vortex'], overall_reliability_rating: 8 }
    };
    expect(swerve.type).toBe('choice');
    expect(readField(motors, pit)).toEqual(['X60', 'Vortex']);
    expect(reliability).toMatchObject({ type: 'rating', max: 10, section: 'ratings' });
    expect(readField(reliability, pit)).toBe(8);
  });
});

describe('custom questions', () => {
  const choice = {
    id: 'q_pick',
    section: 'teleop',
    type: 'mcq',
    label: 'Climb level',
    options: [
      { id: 'o1', label: 'Low' },
      { id: 'o2', label: 'High' }
    ],
    kinds: ['data']
  };

  it('reads option ids back as their labels', () => {
    const entry = customField('match', choice);
    expect(entry).toMatchObject({ type: 'choice', section: 'teleop', label: 'Climb level', options: ['Low', 'High'] });
    expect(readField(entry, data(5940, 'qm1', { custom_answers: { q_pick: 'o2' } }))).toBe('High');
    expect(readField(entry, data(5940, 'qm1', { custom_answers: { q_pick: 'gone' } }))).toBe(null);
  });

  it('only reads a question on the kinds it was asked on', () => {
    const entry = customField('match', choice);
    expect(readField(entry, data(5940, 'qm1', { report_kind: 'robot', custom_answers: { q_pick: 'o1' } }))).toBe(null);
  });

  it('reads grids as "Row: Option" and checkboxes as lists', () => {
    const grid = customField('match', {
      id: 'q_grid',
      section: 'robot',
      type: 'grid',
      label: 'Status',
      rows: [{ id: 'r1', label: 'Shift 1' }],
      options: [{ id: 'o1', label: 'Dead' }]
    });
    const boxes = customField('pit', {
      id: 'q_box',
      section: 'main',
      type: 'checkboxes',
      label: 'Tools',
      options: [
        { id: 'a', label: 'Lathe' },
        { id: 'b', label: 'Mill' }
      ]
    });
    expect(
      readField(grid, data(5940, 'qm1', { report_kind: 'robot', custom_answers: { q_grid: { r1: 'o1' } } }))
    ).toEqual(['Shift 1: Dead']);
    expect(readField(boxes, { team_key: 'frc5940', custom_answers: { q_box: ['b', 'a'] } })).toEqual(['Mill', 'Lathe']);
    expect(boxes.section).toBe('notes');
  });

  it('keeps the newest wording of a question asked in several versions, in its section', () => {
    const fields = fieldsFor('match', [
      { questions: [{ ...choice, label: 'Climb (new)' }] },
      { questions: [{ ...choice, label: 'Climb (old)' }] }
    ]);
    const custom = fields.filter((entry) => entry.custom);
    expect(custom).toHaveLength(1);
    expect(custom[0].label).toBe('Climb (new)');
    const teleop = fields.filter((entry) => entry.section === 'teleop');
    expect(teleop[teleop.length - 1].custom).toBe(true);
  });
});

describe('filters', () => {
  const records = [
    data(5940, 'qm1'),
    data(254, 'qm12', { report_kind: 'performance' }),
    data(5940, 'sf1m1'),
    data(1678, 'pm2')
  ];

  it('knows qualification, playoff and practice keys', () => {
    expect(matchType('2026cc_qm4')).toBe('qual');
    expect(matchType('2026cc_sf2m1')).toBe('playoff');
    expect(matchType('2026cc_f1m2')).toBe('playoff');
    expect(matchType('2026cc_pm3')).toBe('practice');
  });

  it('filters by team, kind, match type and qualification range', () => {
    expect(filterRecords(records, 'match', { ...emptyFilters(), teams: ['frc5940'] })).toHaveLength(2);
    expect(filterRecords(records, 'match', { ...emptyFilters(), kind: 'performance' })).toHaveLength(1);
    expect(filterRecords(records, 'match', { ...emptyFilters(), matchType: 'playoff' })).toHaveLength(1);
    expect(filterRecords(records, 'match', { ...emptyFilters(), fromMatch: 2, toMatch: 20 })).toEqual([records[1]]);
    expect(lastQualNumber(records)).toBe(12);
  });

  it('only shows the fields a kind of report asks, plus the shared ones', () => {
    const fields = filterFields(BUILT_IN_FIELDS.match, { ...emptyFilters(), kind: 'robot' });
    expect(fields.some((entry) => entry.id === 'significant_crash')).toBe(true);
    expect(fields.some((entry) => entry.id === 'balls_scored')).toBe(false);
    expect(fields.some((entry) => entry.id === 'robot_present')).toBe(true);
    expect(
      filterFields(BUILT_IN_FIELDS.match, { ...emptyFilters(), section: 'auto' }).every((e) => e.section === 'auto')
    ).toBe(true);
  });

  it('lists the teams in the reports in number order', () => {
    expect(teamOptions(records, new Map([['frc254', 'Cheesy Poofs']]))).toEqual([
      { value: 'frc254', number: '254', name: 'Cheesy Poofs' },
      { value: 'frc1678', number: '1678', name: '' },
      { value: 'frc5940', number: '5940', name: '' }
    ]);
  });
});

describe('summaries', () => {
  const records = [
    data(5940, 'qm2', { balls_scored_average: 60, shuttled: true, teleop_roles: ['scorer', 'defense'] }),
    data(5940, 'qm1', { balls_scored_average: 40, shuttled: false, teleop_roles: ['scorer'] }),
    data(254, 'qm1', { balls_scored_average: null, shuttled: true })
  ];

  it('averages numbers per team and skips blanks', () => {
    const summary = summarizeField(field('match', 'balls_scored'), records);
    expect(summary.count).toBe(2);
    expect(summary.average).toBe(50);
    expect(summary.teams).toEqual([{ teamKey: 'frc5940', team: '5940', count: 2, average: 50, min: 40, max: 60 }]);
    expect(summary.answers.map((answer) => answer.match)).toEqual(['Qual 1', 'Qual 2']);
  });

  it('gives yes/no fields a share per team and Yes before No', () => {
    const summary = summarizeField(field('match', 'shuttled'), records);
    expect(summary.distribution).toEqual([
      { label: 'Yes', count: 2 },
      { label: 'No', count: 1 }
    ]);
    expect(summary.teams.find((row) => row.team === '5940')).toMatchObject({ yes: 1, share: 0.5 });
  });

  it('counts each item of a list answer', () => {
    const roles = field('match', 'teleop_roles');
    const summary = summarizeField(roles, records);
    expect(answerCounts(roles, summary.answers)).toEqual([
      { label: 'Scorer', count: 2 },
      { label: 'Defense', count: 1 }
    ]);
  });

  it('shows every rating step, even unused ones', () => {
    const summary = summarizeField(field('match', 'shuttle_rating'), [
      data(5940, 'qm1', { shuttle_rating: 4 }),
      data(5940, 'qm2', { shuttle_rating: 4 })
    ]);
    expect(summary.distribution.map((step) => step.count)).toEqual([0, 0, 0, 2, 0]);
  });

  it('groups fields by section in form order', () => {
    const groups = groupBySection(
      BUILT_IN_FIELDS.match.filter((entry) => ['auto', 'teleop'].includes(entry.section)),
      records
    );
    expect(groups.map((group) => group.label)).toEqual(['Auto', 'Teleop']);
  });

  it('formats numbers without trailing decimals and blanks as a dash', () => {
    expect(formatNumber(4)).toBe('4');
    expect(formatNumber(4.25)).toBe('4.3');
    expect(formatNumber(null)).toBe('—');
  });
});

describe('CSV of the view', () => {
  it('has one row per report with the shown fields, and neutralizes formulas', () => {
    const csv = viewToCsv(
      'match',
      [field('match', 'balls_scored'), field('match', 'teleop_notes')],
      [data(5940, 'qm1', { balls_scored_average: 40, teleop_notes: '=HYPERLINK("x")' })]
    );
    const lines = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe('Match,Team,Report,Scout,Balls scored (estimate),Teleop notes');
    expect(lines[1]).toBe(`Qual 1,5940,Data,Scout A,40,"'=HYPERLINK(""x"")"`);
  });
});

describe('chart rows', () => {
  it('orders team bars best first and labels yes/no shares', () => {
    const summary = summarizeField(
      BUILT_IN_FIELDS.match.find((entry) => entry.id === 'shuttled'),
      [data(5940, 'qm1', { shuttled: false }), data(254, 'qm1', { shuttled: true })]
    );
    expect(chartKind(summary.field)).toBe('teams');
    expect(barScale(summary.field)).toBe(1);
    expect(teamBarRows(summary).map((row) => [row.label, row.text])).toEqual([
      ['254', '100% · 1/1'],
      ['5940', '0% · 0/1']
    ]);
    expect(headline(summary)).toBe('50% yes');
  });

  it('says a field nobody answered is not scouted yet', () => {
    const summary = summarizeField(
      BUILT_IN_FIELDS.match.find((entry) => entry.id === 'auto_cycles'),
      []
    );
    expect(headline(summary)).toBe('Not scouted yet');
    expect(teamBarRows(summary)).toEqual([]);
  });
});

describe('scout entries', () => {
  const records = [
    data(5940, 'qm1', { id: 'a', balls_scored_average: 40 }),
    data(254, 'qm2', { id: 'b', report_kind: 'robot', significant_crash: true, scout_name: 'Pat' }),
    data(5940, 'qm2', { id: 'c' })
  ];

  it('lists the latest match first and finds a team, match, kind or scout', () => {
    expect(entryList(records).map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
    expect(entryList(records, 'pat').map((entry) => entry.id)).toEqual(['b']);
    expect(entryList(records, 'qual 1').map((entry) => entry.id)).toEqual(['a']);
    expect(entryList(records, 'robot').map((entry) => entry.id)).toEqual(['b']);
  });

  it('gives a record without an id a stable one', () => {
    expect(recordId({ team_key: 'frc5940', match_key: '2026cc_qm1', created_at: 't' })).toBe('frc5940:2026cc_qm1:t');
  });

  it("shows only the questions a report's kind asked, blanks as null", () => {
    const robot = entrySections(BUILT_IN_FIELDS.match, records[1]);
    const ids = robot.flatMap((section) => section.answers.map((answer) => answer.field.id));
    expect(ids).toContain('significant_crash');
    expect(ids).not.toContain('balls_scored');
    const crash = robot.flatMap((section) => section.answers).find((answer) => answer.field.id === 'significant_crash');
    expect(crash.text).toBe('Yes');
    const data5940 = entrySections(BUILT_IN_FIELDS.match, records[2]);
    expect(data5940.flatMap((s) => s.answers).find((a) => a.field.id === 'balls_scored').text).toBe(null);
  });

  it('finds the previous and next item', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(neighbors(items, 'b')).toEqual({ previous: { id: 'a' }, next: { id: 'c' }, index: 1, total: 3 });
    expect(neighbors(items, 'z').index).toBe(-1);
  });
});

describe('field trend', () => {
  const series = (team, values) => values.map((value, i) => data(team, `qm${i + 1}`, { balls_scored_average: value }));

  it('ranks teams by last three matches minus first three, best improver first', () => {
    const summary = summarizeField(field('match', 'balls_scored'), [
      ...series(5940, [10, 10, 10, 40, 40, 40]),
      ...series(254, [50, 50, 50, 40, 40, 40]),
      ...series(1678, [10, 20])
    ]);
    const trend = fieldTrend(summary);
    expect(trend.rows.map((row) => [row.label, row.value, row.n])).toEqual([
      ['5940', 30, 6],
      ['254', -10, 6]
    ]);
    expect(trend.notEnough).toEqual(['1678']);
  });

  it('averages several scouts on one match before trending, and skips non-numeric fields', () => {
    const summary = summarizeField(field('match', 'balls_scored'), [
      ...series(5940, [10, 10, 10, 40, 40, 40]),
      data(5940, 'qm6', { id: 'second-scout', balls_scored_average: 20 })
    ]);
    // Match 6 averages 40 and 20 to 30, so late = (40 + 40 + 30) / 3 and early = 10.
    expect(fieldTrend(summary).rows[0].value).toBeCloseTo(110 / 3 - 10, 6);
    expect(fieldTrend(summarizeField(field('match', 'shuttled'), [])).rows).toEqual([]);
  });
});

describe('following the published form', () => {
  it("uses an admin's wording for a one-field block and marks hidden blocks", () => {
    const schema = {
      questions: [],
      core: { 'teleop.balls': { label: 'Fuel scored' }, 'teleop.defense': { hidden: true, label: 'Defense' } },
      order: {}
    };
    const fields = fieldsFor('match', [schema]);
    expect(fields.find((entry) => entry.id === 'balls_scored').label).toBe('Fuel scored');
    const defense = fields.filter((entry) => entry.id.startsWith('defense_') && entry.id !== 'defense_rating');
    expect(defense.length).toBe(4);
    expect(defense.every((entry) => entry.hiddenOnForm)).toBe(true);
    // A block with several fields keeps each field's own name.
    expect(defense.find((entry) => entry.id === 'defense_targets').label).toBe('Defended against');
  });

  it('leaves the built-in wording alone without a published form', () => {
    expect(fieldsFor('match', []).find((entry) => entry.id === 'balls_scored').label).toBe('Balls scored (estimate)');
  });
});

describe('form block map', () => {
  it('only names real fields and real blocks', async () => {
    const { BLOCK_FIELDS } = await import('./dataViewerFields.js');
    const { FORM_TYPES } = await import('./forms/formSchema.js');
    for (const form of ['match', 'pit']) {
      const ids = new Set(BUILT_IN_FIELDS[form].map((entry) => entry.id));
      const blocks = new Set(FORM_TYPES[form].sections.flatMap((section) => section.blocks.map((block) => block.key)));
      for (const [block, fields] of Object.entries(BLOCK_FIELDS[form])) {
        expect(blocks.has(block), block).toBe(true);
        for (const id of fields) expect(ids.has(id), `${block} -> ${id}`).toBe(true);
      }
    }
  });
});

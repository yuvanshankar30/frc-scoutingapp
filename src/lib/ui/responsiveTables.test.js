import { describe, expect, it } from 'vitest';
import { CARD_CLASS, headerLabels, labelTable, shouldCard } from './responsiveTables.js';

// Just enough of the DOM table API for these functions.
function cell(text, { colSpan = 1, attrs = {} } = {}) {
  const attributes = new Map(Object.entries(attrs));
  return {
    textContent: text,
    colSpan,
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name)
  };
}
function table({ head = [], body = [], keep = false } = {}) {
  const classes = new Set();
  return {
    tHead: head.length ? { rows: head.map((row) => ({ cells: row })) } : null,
    tBodies: [{ rows: body.map((row) => ({ cells: row })) }],
    hasAttribute: (name) => keep && name === 'data-keep-table',
    classList: { add: (name) => classes.add(name), contains: (name) => classes.has(name) }
  };
}

describe('responsive tables', () => {
  it('reads the last header row, expanding colspans', () => {
    const t = table({
      head: [[cell('Red', { colSpan: 3 })], [cell('Team'), cell(' EPA \n'), cell('Auto', { colSpan: 2 })]]
    });
    expect(headerLabels(t)).toEqual(['Team', 'EPA', 'Auto', 'Auto']);
  });

  it('labels each body cell by its column and marks the table', () => {
    const row = [cell('5940'), cell('41.5'), cell('12', { colSpan: 2 }), cell('x')];
    const t = table({ head: [[cell('Team'), cell('EPA'), cell('Auto'), cell('Teleop'), cell('Notes')]], body: [row] });
    expect(labelTable(t)).toBe(true);
    expect(row.map((c) => c.getAttribute('data-label'))).toEqual(['Team', 'EPA', 'Auto', 'Notes']);
    expect(t.classList.contains(CARD_CLASS)).toBe(true);
  });

  it('leaves narrow, headerless, opted-out and already-labelled tables alone', () => {
    expect(shouldCard(table({ head: [[cell('A'), cell('B')]] }))).toBe(false);
    expect(shouldCard(table({ body: [[cell('1'), cell('2'), cell('3')]] }))).toBe(false);
    expect(shouldCard(table({ head: [[cell('A'), cell('B'), cell('C')]], keep: true }))).toBe(false);
    const own = table({
      head: [[cell('A'), cell('B'), cell('C')]],
      body: [[cell('1', { attrs: { 'data-label': 'A' } }), cell('2'), cell('3')]]
    });
    expect(shouldCard(own)).toBe(false);
  });

  it('relabels a marked table when its rows change', () => {
    const t = table({ head: [[cell('Team'), cell('EPA'), cell('Rank')]], body: [[cell('1'), cell('2'), cell('3')]] });
    labelTable(t);
    const added = [cell('4'), cell('5'), cell('6')];
    t.tBodies[0].rows.push({ cells: added });
    expect(labelTable(t)).toBe(true);
    expect(added[2].getAttribute('data-label')).toBe('Rank');
  });
});

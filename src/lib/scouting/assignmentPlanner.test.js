import { describe, expect, it } from 'vitest';
import { autoFill, conflictsFor, matchLoad, ownership, parseTeamInput, teamMatchMap } from './assignmentPlanner.js';

const m = (key, red, blue) => ({ key, red, blue });
const matches = [
  m('q1', ['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']),
  m('q2', ['frc1', 'frc4', 'frc7'], ['frc2', 'frc5', 'frc8']),
  m('q3', ['frc3', 'frc6', 'frc7'], ['frc1', 'frc8', 'frc9'])
];
const map = teamMatchMap(matches);

describe('parseTeamInput', () => {
  it('reads team numbers separated by commas, spaces or semicolons, once each', () => {
    expect(parseTeamInput('5940, 254  1678;5940')).toEqual(['frc5940', 'frc254', 'frc1678']);
  });
  it('accepts frc prefixes and #, and ignores junk', () => {
    expect(parseTeamInput('frc254 #1678 abc')).toEqual(['frc254', 'frc1678']);
    expect(parseTeamInput('')).toEqual([]);
    expect(parseTeamInput(null)).toEqual([]);
  });
});

describe('teamMatchMap and matchLoad', () => {
  it('lists the matches each team plays', () => {
    expect(map.get('frc1')).toEqual(['q1', 'q2', 'q3']);
    expect(map.get('frc9')).toEqual(['q3']);
  });
  it('totals the matches a scout would cover', () => {
    expect(matchLoad(['frc1', 'frc9'], map)).toBe(4);
  });
});

describe('ownership', () => {
  it('gives a team one owner only when that scout holds every one of its matches', () => {
    const assignments = {
      q1: { frc9: undefined, frc1: { user_id: 'a' } },
      q2: { frc1: { user_id: 'a' } },
      q3: { frc1: { user_id: 'a' }, frc9: { user_id: 'b' } }
    };
    expect(ownership(assignments, matches).get('frc1')).toEqual({ userId: 'a', partial: false });
    expect(ownership(assignments, matches).get('frc9')).toEqual({ userId: 'b', partial: false });
  });
  it('flags a team that is only partly assigned or split between scouts', () => {
    const half = { q1: { frc1: { user_id: 'a' } } };
    expect(ownership(half, matches).get('frc1')).toEqual({ userId: '', partial: true });
    const split = { q1: { frc1: { user_id: 'a' } }, q2: { frc1: { user_id: 'b' } }, q3: { frc1: { user_id: 'a' } } };
    expect(ownership(split, matches).get('frc1')).toEqual({ userId: '', partial: true });
  });
  it('treats an unassigned team as unowned and not partial', () => {
    expect(ownership({}, matches).get('frc2')).toEqual({ userId: '', partial: false });
  });
});

describe('conflictsFor', () => {
  it('finds teams that play in the same match', () => {
    const found = conflictsFor(['frc1', 'frc2', 'frc9'], map);
    expect(found.map((c) => [c.a, c.b, c.matches])).toEqual([
      ['frc1', 'frc2', ['q1', 'q2']],
      ['frc1', 'frc9', ['q3']]
    ]);
  });
  it('finds nothing for teams that never meet', () => {
    expect(conflictsFor(['frc2', 'frc9'], map)).toEqual([]);
  });
});

describe('autoFill', () => {
  it('spreads teams evenly and keeps each scout clash-free when it can', () => {
    const teams = ['frc1', 'frc2', 'frc3', 'frc9'];
    const scouts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const { plan, clashes } = autoFill({ teams, scouts, held: new Map(), matchMap: map });
    expect(clashes).toBe(0);
    expect(new Set(plan.values()).size).toBe(4);
  });
  it('never moves teams a scout already holds, and avoids clashing with them', () => {
    const held = new Map([['a', ['frc1']]]);
    const { plan } = autoFill({ teams: ['frc2', 'frc9'], scouts: [{ id: 'a' }, { id: 'b' }], held, matchMap: map });
    expect(plan.get('frc2')).toBe('b');
  });
  it('reports a clash when every scout would be asked to watch two robots at once', () => {
    const held = new Map([['a', ['frc1']]]);
    const { plan, clashes } = autoFill({ teams: ['frc2'], scouts: [{ id: 'a' }], held, matchMap: map });
    expect(plan.get('frc2')).toBe('a');
    expect(clashes).toBe(1);
  });
  it('returns nothing to do without scouts or teams', () => {
    expect(autoFill({ teams: [], scouts: [{ id: 'a' }], held: new Map(), matchMap: map }).plan.size).toBe(0);
    expect(autoFill({ teams: ['frc1'], scouts: [], held: new Map(), matchMap: map }).plan.size).toBe(0);
  });
});

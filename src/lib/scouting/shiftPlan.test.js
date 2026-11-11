import { describe, expect, it } from 'vitest';
import { assignmentsFromShifts, autoPlan, qualRange, validateShifts } from './shiftPlan.js';

const match = (n, red, blue) => ({
  key: `2026cc_qm${n}`,
  comp_level: 'qm',
  match_number: n,
  alliances: { red: { team_keys: red }, blue: { team_keys: blue } }
});
const schedule = [
  match(1, ['frc1', 'frc2', 'frc3'], ['frc4', 'frc5', 'frc6']),
  match(2, ['frc7', 'frc8', 'frc9'], ['frc10', 'frc11', 'frc12']),
  { key: '2026cc_sf1m1', comp_level: 'sf', match_number: 1 }
];

describe('shift plans', () => {
  it('reads the qualification range', () => {
    expect(qualRange(schedule)).toEqual({ first: 1, last: 2 });
    expect(qualRange([])).toBeNull();
  });

  it('turns shifts into the robot in that slot for every match', () => {
    const { items, missing } = assignmentsFromShifts(
      [
        { slot: 'red2', start: 1, end: 2, userId: 'a' },
        { slot: 'blue3', start: 2, end: 3, userId: 'b' }
      ],
      schedule
    );
    expect(items).toEqual([
      { match_key: '2026cc_qm1', team_key: 'frc2', user_id: 'a' },
      { match_key: '2026cc_qm2', team_key: 'frc8', user_id: 'a' },
      { match_key: '2026cc_qm2', team_key: 'frc12', user_id: 'b' }
    ]);
    expect(missing).toBe(1);
  });

  it('rotates scouts so each keeps a slot and gets a break', () => {
    const scouts = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const { shifts, notes } = autoPlan({ scouts, length: 5, firstMatch: 1, lastMatch: 12 });
    const red1 = shifts.filter((shift) => shift.slot === 'red1');
    expect(red1.map((s) => [s.start, s.end, s.userId])).toEqual([
      [1, 5, 's0'],
      [6, 10, 's6'],
      [11, 12, 's0']
    ]);
    expect(notes).toEqual([]);
    expect(validateShifts(shifts, { firstMatch: 1, lastMatch: 12 })).toEqual([]);
  });

  it('says when a slot has nobody or no break', () => {
    expect(autoPlan({ scouts: ['a', 'b'], length: 5, firstMatch: 1, lastMatch: 10 }).notes.join(' ')).toMatch(
      /Nobody covers Red 3, Blue 1, Blue 2, Blue 3.*Red 1, Red 2 have one scout/
    );
  });

  it('finds overlaps, double-booked scouts and bad ranges', () => {
    const problems = validateShifts(
      [
        { slot: 'red1', start: 1, end: 5, userId: 'a' },
        { slot: 'red1', start: 5, end: 8, userId: 'b' },
        { slot: 'blue1', start: 3, end: 4, userId: 'a' },
        { slot: 'blue2', start: 9, end: 2, userId: 'c' },
        { slot: 'blue3', start: 1, end: 99, userId: 'd' },
        { slot: 'red2', start: 1, end: 2, userId: null }
      ],
      { firstMatch: 1, lastMatch: 60, names: new Map([['a', 'Ana']]) }
    );
    expect(problems).toEqual([
      'Blue 2 Q9–Q2 ends before it starts.',
      'Blue 3 Q1–Q99 runs past the schedule (Q1–Q60).',
      'Red 2 Q1–Q2 has no scout.',
      'Red 1 Q1–Q5 overlaps Red 1 Q5–Q8.',
      'Ana is on Red 1 Q1–Q5 and Blue 1 Q3–Q4 at the same time.'
    ]);
  });
});

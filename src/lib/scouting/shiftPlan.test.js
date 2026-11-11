import { describe, expect, it } from 'vitest';
import {
  assignmentsFromShifts,
  autoPlan,
  groupShifts,
  qualRange,
  rosterOf,
  rowsFromRoster,
  scoutMatches,
  validateShifts
} from './shiftPlan.js';

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

  it('allows shared slots, whole-alliance scouts and open seats, but not the same seat twice', () => {
    const problems = validateShifts(
      [
        { slot: 'red1', start: 1, end: 5, userId: 'a' },
        { slot: 'red1', start: 1, end: 5, userId: 'b' },
        { slot: 'red2', start: 1, end: 5, userId: 'a' },
        { slot: 'red3', start: 1, end: 5, userId: null },
        { slot: 'red1', start: 3, end: 8, userId: 'a' },
        { slot: 'blue2', start: 9, end: 2, userId: 'c' },
        { slot: 'blue3', start: 1, end: 99, userId: 'd' }
      ],
      { firstMatch: 1, lastMatch: 60, names: new Map([['a', 'Ana']]) }
    );
    expect(problems).toEqual([
      'Blue 2 Q9–Q2 ends before it starts.',
      'Blue 3 Q1–Q99 runs past the schedule (Q1–Q60).',
      'Ana is on Red 1 Q1–Q5 twice.'
    ]);
  });

  it('groups seats into numbered shifts and seats a roster in order', () => {
    let n = 0;
    const newId = () => `s${(n += 1)}`;
    const seats = rowsFromRoster(['a', 'b', 'c', 'd', 'e', 'f', 'g'], { start: 11, end: 20, newId });
    expect(seats.map((seat) => seat.slot)).toEqual(['red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3', 'red1']);
    const shifts = groupShifts([...seats, { id: 'x', slot: 'blue1', start: 1, end: 10, userId: 'z' }]);
    expect(shifts.map((shift) => [shift.number, shift.start, shift.rows.length])).toEqual([
      [1, 1, 1],
      [2, 11, 7]
    ]);
    expect(rosterOf(shifts[1].rows).map((seat) => seat.userId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it("lists each scout's exact matches and robots", () => {
    const work = scoutMatches(
      [
        { slot: 'red1', start: 1, end: 2, userId: 'a' },
        { slot: 'blue3', start: 2, end: 3, userId: 'a' }
      ],
      schedule
    );
    expect(work.get('a')).toEqual([
      { number: 1, matchKey: '2026cc_qm1', teamKey: 'frc1', slot: 'red1', slotLabel: 'Red 1' },
      { number: 2, matchKey: '2026cc_qm2', teamKey: 'frc7', slot: 'red1', slotLabel: 'Red 1' },
      { number: 2, matchKey: '2026cc_qm2', teamKey: 'frc12', slot: 'blue3', slotLabel: 'Blue 3' },
      { number: 3, matchKey: null, teamKey: null, slot: 'blue3', slotLabel: 'Blue 3' }
    ]);
  });
});

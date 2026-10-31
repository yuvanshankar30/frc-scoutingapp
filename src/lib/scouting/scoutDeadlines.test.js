import { describe, it, expect } from 'vitest';
import {
  atClock,
  buildMatchRows,
  deadlinesForRange,
  matchLabel,
  matchNumber,
  owedByScout,
  parseClock,
  summarize
} from './scoutDeadlines.js';

const match = (n, extra = {}) => ({
  key: `2026cc_qm${n}`,
  match_number: n,
  time: 1790000000 + n * 480,
  alliances: { red: { team_keys: ['frc1', 'frc2', 'frc3'] }, blue: { team_keys: ['frc4', 'frc5', 'frc6'] } },
  ...extra
});
const NOW = new Date('2026-09-20T12:00:00Z');

describe('match keys and clock text', () => {
  it('reads qualification numbers', () => {
    expect(matchNumber('2026cc_qm12')).toBe(12);
    expect(matchLabel('2026cc_qm7')).toBe('Q7');
    expect(matchNumber('2026cc_sf1m1')).toBeNull();
  });
  it('parses times people type', () => {
    expect(parseClock('6:30pm')).toEqual({ hours: 18, minutes: 30 });
    expect(parseClock('6 PM')).toEqual({ hours: 18, minutes: 0 });
    expect(parseClock('18:30')).toEqual({ hours: 18, minutes: 30 });
    expect(parseClock('12am')).toEqual({ hours: 0, minutes: 0 });
    expect(parseClock('12:15 pm')).toEqual({ hours: 12, minutes: 15 });
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('soon')).toBeNull();
  });
  it('joins a day and a time', () => {
    const date = atClock('2026-09-20', '6:30pm');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([
      2026, 8, 20, 18, 30
    ]);
    expect(atClock('', '6pm')).toBeNull();
  });
});

describe('buildMatchRows', () => {
  const assignments = [
    { match_key: '2026cc_qm1', team_key: 'frc1', assigned_user: 'a', user_name: 'Ana' },
    { match_key: '2026cc_qm1', team_key: 'frc2', assigned_user: 'b', user_name: 'Ben' },
    { match_key: '2026cc_qm2', team_key: 'frc1', assigned_user: 'a', user_name: 'Ana' }
  ];
  it('marks reported, late and unassigned slots', () => {
    const rows = buildMatchRows({
      matches: [match(1)],
      assignments,
      reports: [{ match_key: '2026cc_qm1', team_key: 'frc1', created_by: 'a' }],
      deadlines: new Map([['2026cc_qm1', '2026-09-20T11:00:00Z']]),
      now: NOW
    });
    const status = Object.fromEntries(rows[0].slots.map((slot) => [slot.teamKey, slot.status]));
    expect(status.frc1).toBe('done');
    expect(status.frc2).toBe('late');
    expect(status.frc3).toBe('unassigned');
    expect(rows[0].state).toBe('late');
    expect(rows[0].counts).toMatchObject({ done: 1, late: 1, unassigned: 4 });
  });
  it('still says a robot has no scout when someone reported it anyway', () => {
    const rows = buildMatchRows({
      matches: [match(1)],
      reports: [{ match_key: '2026cc_qm1', team_key: 'frc5', created_by: 'z', scout_name: 'Zed' }],
      now: NOW
    });
    expect(rows[0].slots.find((slot) => slot.teamKey === 'frc5')).toMatchObject({
      status: 'done',
      hasScout: false,
      scoutName: null
    });
  });
  it('is open, not late, before the deadline', () => {
    const rows = buildMatchRows({
      matches: [match(1)],
      assignments,
      deadlines: new Map([['2026cc_qm1', '2026-09-20T13:00:00Z']]),
      now: NOW
    });
    expect(rows[0].state).toBe('open');
    expect(rows[0].slots[1].status).toBe('pending');
  });
  it('calls a slot missed when the scout reported a later match', () => {
    const rows = buildMatchRows({
      matches: [match(1), match(2)],
      assignments,
      reports: [
        { match_key: '2026cc_qm2', team_key: 'frc1', created_by: 'b' },
        { match_key: '2026cc_qm3', team_key: 'frc9', created_by: 'a' }
      ],
      now: NOW
    });
    expect(rows[0].slots.find((slot) => slot.teamKey === 'frc1').status).toBe('missed');
  });
  it('has no state without a deadline or reports', () => {
    expect(buildMatchRows({ matches: [match(1)], now: NOW })[0].state).toBe('none');
  });
});

describe('summaries', () => {
  it('counts late matches and groups owed reports by scout', () => {
    const rows = buildMatchRows({
      matches: [match(1), match(2)],
      assignments: [
        { match_key: '2026cc_qm1', team_key: 'frc1', assigned_user: 'a', user_name: 'Ana' },
        { match_key: '2026cc_qm2', team_key: 'frc4', assigned_user: 'a', user_name: 'Ana' }
      ],
      deadlines: new Map([
        ['2026cc_qm1', '2026-09-20T11:00:00Z'],
        ['2026cc_qm2', '2026-09-20T11:30:00Z']
      ]),
      now: NOW
    });
    expect(summarize(rows)).toMatchObject({ matches: 2, withDeadline: 2, late: 2, lateSlots: 2 });
    const owed = owedByScout(rows);
    expect(owed).toHaveLength(1);
    expect(owed[0].items.map((item) => item.match)).toEqual(['Q1', 'Q2']);
  });
});

describe('deadlinesForRange', () => {
  const rows = buildMatchRows({ matches: [match(1), match(2), match(3), match(4, { time: null })], now: NOW });
  it('offsets from the scheduled start and skips unscheduled matches', () => {
    const { items, skipped } = deadlinesForRange(rows, { from: 2, to: 4, mode: 'after', offsetMinutes: 30 });
    expect(items.map((item) => item.match_key)).toEqual(['2026cc_qm2', '2026cc_qm3']);
    expect(skipped).toBe(1);
    expect(new Date(items[0].due_at).getTime()).toBe((1790000000 + 2 * 480 + 1800) * 1000);
  });
  it('sets one fixed time, whichever order the range is given in', () => {
    const at = new Date('2026-09-20T20:00:00Z');
    const { items } = deadlinesForRange(rows, { from: 3, to: 1, mode: 'at', at });
    expect(items.map((item) => item.due_at)).toEqual([at.toISOString(), at.toISOString(), at.toISOString()]);
  });
});

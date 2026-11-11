import { describe, expect, it } from 'vitest';
import { DRIVE_COACH_MINUTES, buildMeetingPlan } from './meetingPlan.js';

const US = 'frc5940';
const START = 1_800_000_000;
const filler = (n) => [`frc${9000 + n * 6}`, `frc${9001 + n * 6}`, `frc${9002 + n * 6}`];
// Match n at START + n*600 (one every ten minutes); `red` / `blue` override the alliances.
const match = (n, { red, blue, ...extra } = {}) => ({
  key: `2026test_qm${n}`,
  comp_level: 'qm',
  match_number: n,
  predicted_time: START + n * 600,
  alliances: { red: { team_keys: red || filler(n) }, blue: { team_keys: blue || filler(n + 100) } },
  ...extra
});
const schedule = (count, special = {}) => Array.from({ length: count }, (_, i) => match(i + 1, special[i + 1] || {}));

describe('strategy meeting plan', () => {
  it('lines each step up with the right match before ours', () => {
    const matches = schedule(30, { 20: { red: [US, 'frc254', 'frc1678'] } });
    const [plan] = buildMeetingPlan(matches, US, { now: 0 });
    expect(plan.match.match_number).toBe(20);
    expect(plan.partners).toEqual(['frc254', 'frc1678']);
    expect(plan.steps.arrange.match.match_number).toBe(10);
    expect(plan.steps.pitCrew.match.match_number).toBe(15);
    expect(plan.steps.driveCoach.match.match_number).toBe(19);
    expect(plan.steps.driveCoach.time).toBe(START + 20 * 600 - DRIVE_COACH_MINUTES * 60);
    // Nobody else is busy, so the meeting goes in the latest slot before the pit crew's.
    expect(plan.steps.meet.match.match_number).toBe(14);
    expect(plan.steps.meet.busy).toEqual([]);
    expect(plan.next).toBe('arrange');
  });

  it('moves the meeting off slots where a partner is queueing, playing or walking back', () => {
    // 254 plays match 14: busy from 12 (queueing) through 15 (walking back). Free slots left: 11.
    const matches = schedule(30, {
      14: { blue: ['frc254', 'frc1', 'frc2'] },
      20: { red: [US, 'frc254', 'frc1678'] }
    });
    const [plan] = buildMeetingPlan(matches, US, { now: 0 });
    expect(plan.steps.meet.match.match_number).toBe(11);
    expect(plan.steps.meet.busy).toEqual([]);
  });

  it('picks the slot with the fewest busy teams when nobody is free, and says who is busy', () => {
    const matches = schedule(30, {
      12: { blue: ['frc254', 'frc1', 'frc2'] },
      14: { blue: ['frc1678', 'frc3', 'frc4'] },
      20: { red: [US, 'frc254', 'frc1678'] }
    });
    const [plan] = buildMeetingPlan(matches, US, { now: 0 });
    // 254 is busy 10-13 and 1678 is busy 12-15: slots 11-14 all have one busy team; the latest one wins.
    expect(plan.steps.meet.match.match_number).toBe(14);
    expect(plan.steps.meet.busy).toEqual(['frc1678']);
  });

  it('marks steps that are already behind us and points at the next one', () => {
    const matches = schedule(30, { 20: { red: [US, 'frc254', 'frc1678'] } });
    const now = START + 12 * 600 + 1; // match 12 has started
    const [plan] = buildMeetingPlan(matches, US, { now });
    expect(plan.steps.arrange.done).toBe(true);
    expect(plan.steps.meet.done).toBe(false);
    expect(plan.next).toBe('meet');
  });

  it('handles our first matches, before there are ten matches to count back', () => {
    const matches = schedule(10, { 3: { blue: ['frc254', US, 'frc1678'] } });
    const [plan] = buildMeetingPlan(matches, US, { now: 0 });
    expect(plan.alliance).toBe('blue');
    expect(plan.steps.arrange.match).toBeNull();
    // Steps before the first match are due now, not done.
    expect(plan.steps.arrange.done).toBe(false);
    expect(plan.steps.meet.match).toBeNull();
    expect(plan.steps.pitCrew.match).toBeNull();
    expect(plan.steps.driveCoach.match.match_number).toBe(2);
    expect(plan.next).toBe('arrange');
  });

  it('skips played and practice matches and honours the limit', () => {
    const matches = [
      ...schedule(40, {
        5: { red: [US, 'frc1', 'frc2'], actual_time: START + 5 * 600 },
        20: { red: [US, 'frc3', 'frc4'] },
        30: { red: [US, 'frc5', 'frc6'] }
      }),
      match(99, { red: [US, 'frc7', 'frc8'], is_test_market: true, predicted_time: null })
    ];
    expect(buildMeetingPlan(matches, US, { now: 0 }).map((plan) => plan.match.match_number)).toEqual([20, 30]);
    expect(buildMeetingPlan(matches, US, { now: 0, limit: 1 })).toHaveLength(1);
    expect(buildMeetingPlan([], US)).toEqual([]);
    expect(buildMeetingPlan(undefined, US)).toEqual([]);
  });

  it('keeps untimed playoff matches after the quals', () => {
    const quals = schedule(12).map((entry) => ({ ...entry, predicted_time: null }));
    const playoff = {
      key: '2026test_sf1m1',
      comp_level: 'sf',
      set_number: 1,
      match_number: 1,
      alliances: { red: { team_keys: [US, 'frc254', 'frc1678'] }, blue: { team_keys: ['frc1', 'frc2', 'frc3'] } }
    };
    const [plan] = buildMeetingPlan([playoff, ...quals], US, { now: 0 });
    expect(plan.match.key).toBe('2026test_sf1m1');
    // Ten matches before the 13th match in play order is qm3.
    expect(plan.steps.arrange.match.match_number).toBe(3);
  });
});

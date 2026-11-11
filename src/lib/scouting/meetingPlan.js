// When to talk strategy with each alliance before one of our matches. Built from the event's
// match schedule, counting in matches rather than minutes because that is how the team works at an event:
//   - about 10 matches before, find or text someone on each partner team and agree a meeting time;
//   - meet in the gap that suits all three teams, before the pit crew needs the plan;
//   - about 5 matches before, the pit crew gets our strategy so they can check every robot can do its part;
//   - about 10 minutes (1-2 matches) before, tell the drive coach the plan.
import { isMatchPlayed } from '../matches/matchProjection.js';
import { matchOrder, teamAlliance, timeFor } from './strategySchedule.js';

export const MEETING_LEADS = Object.freeze({ arrange: 10, pitCrew: 5, driveCoach: 1 });
export const DRIVE_COACH_MINUTES = 10;
export const DRIVE_COACH_NAME = 'the drive coach';
// A team is hard to pull into a meeting while it queues (about two matches before it plays), plays, or
// walks back from the field (the match after).
export const QUEUE_AHEAD = 2;
export const BACK_FROM_FIELD = 1;

/**
 * For each of our upcoming matches, the slot (an event match) for each step:
 * `arrange` (set the meeting time), `meet` (the strategy meeting), `pitCrew` (send the plan to the pit crew) and
 * `driveCoach` (tell the drive coach). Each step is `{ index, match, time, done }`: `match` is the event
 * match the step lines up with (null when the step falls before the first match of the event), `time` the
 * expected start of that match in seconds (for `driveCoach`, ten minutes before our match), and `done`
 * whether that slot has already gone by. `meet` also lists the teams that are busy at that slot (empty when
 * all three are free).
 */
export function buildMeetingPlan(matches = [], teamKey, { now = Date.now() / 1000, limit = Infinity } = {}) {
  const order = (Array.isArray(matches) ? matches : []).filter((match) => !match?.is_test_market).sort(matchOrder);
  // Every slot each team is on the field.
  const slotsByTeam = new Map();
  order.forEach((match, index) => {
    for (const color of ['red', 'blue'])
      for (const key of match?.alliances?.[color]?.team_keys || []) {
        if (!slotsByTeam.has(key)) slotsByTeam.set(key, []);
        slotsByTeam.get(key).push(index);
      }
  });
  const busyAt = (key, index) =>
    (slotsByTeam.get(key) || []).some((slot) => slot - QUEUE_AHEAD <= index && index <= slot + BACK_FROM_FIELD);
  const gone = (index) => {
    // A step before the first match of the event hasn't happened: it is due now.
    if (index < 0) return false;
    const match = order[index];
    if (isMatchPlayed(match)) return true;
    const time = timeFor(match);
    return time != null && time <= now;
  };
  const step = (index, time = undefined) => {
    const match = index >= 0 ? order[index] || null : null;
    return { index, match, time: time === undefined ? (match ? timeFor(match) : null) : time, done: gone(index) };
  };

  const plans = [];
  order.forEach((match, index) => {
    const alliance = teamAlliance(match, teamKey);
    if (!alliance || isMatchPlayed(match) || plans.length >= limit) return;
    const partners = (match.alliances?.[alliance]?.team_keys || []).filter((key) => key && key !== teamKey);
    const allianceKeys = [teamKey, ...partners];
    const arrange = index - MEETING_LEADS.arrange;
    const pitCrew = index - MEETING_LEADS.pitCrew;
    // The meeting happens after it was arranged and before the pit crew needs the plan. Prefer a slot where all three
    // teams are free and, among those, the latest one (more scouting to talk about); otherwise the slot with
    // the fewest busy teams.
    let best = null;
    // Real matches win over pre-event slots when there are any in the window.
    for (let slot = Math.min(Math.max(arrange + 1, 0), pitCrew - 1); slot < pitCrew; slot += 1) {
      const busy = allianceKeys.filter((key) => busyAt(key, slot));
      if (!best || busy.length <= best.busy.length) best = { slot, busy };
    }
    const ourTime = timeFor(match);
    const driveCoachTime = ourTime == null ? null : ourTime - DRIVE_COACH_MINUTES * 60;
    const steps = {
      arrange: step(arrange),
      meet: { ...step(best.slot), busy: best.busy },
      pitCrew: step(pitCrew),
      driveCoach: {
        ...step(index - MEETING_LEADS.driveCoach, driveCoachTime),
        done: driveCoachTime != null ? driveCoachTime <= now : gone(index - MEETING_LEADS.driveCoach)
      }
    };
    const next = ['arrange', 'meet', 'pitCrew', 'driveCoach'].find((key) => !steps[key].done) || null;
    plans.push({ match, alliance, partners, steps, next });
  });
  return plans;
}

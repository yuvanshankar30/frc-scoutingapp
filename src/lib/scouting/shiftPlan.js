// Shift-based match scouting (Scouting Admin > Assignments > Shifts). A shift is one scout on one field slot (Red 1 ...
// Blue 3) for a run of qualification matches: during it they scout whichever robot stands in that slot in every match,
// then take a break while the next scout on that slot takes over. Publishing a plan turns every shift into ordinary
// per-match assignments, so scouts see them exactly like any other assignment. Pure, so it can be tested.

export const SLOTS = Object.freeze([
  { key: 'red1', label: 'Red 1', alliance: 'red', index: 0 },
  { key: 'red2', label: 'Red 2', alliance: 'red', index: 1 },
  { key: 'red3', label: 'Red 3', alliance: 'red', index: 2 },
  { key: 'blue1', label: 'Blue 1', alliance: 'blue', index: 0 },
  { key: 'blue2', label: 'Blue 2', alliance: 'blue', index: 1 },
  { key: 'blue3', label: 'Blue 3', alliance: 'blue', index: 2 }
]);
const SLOT_KEYS = new Set(SLOTS.map((slot) => slot.key));

const int = (value) => {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
};

/** A shift as the planner keeps it: { id, slot, start, end, userId }. Bad values come back as null fields. */
export function normalizeShift(raw = {}) {
  return {
    id: String(raw.id || ''),
    slot: SLOT_KEYS.has(raw.slot) ? raw.slot : null,
    start: int(raw.start ?? raw.start_match),
    end: int(raw.end ?? raw.end_match),
    userId: raw.userId ?? raw.assigned_user ?? null
  };
}

/**
 * Problems with a plan, as readable sentences: a shift with no scout, a backwards range, a range outside the
 * schedule, two shifts on the same slot that overlap, and one scout in two places at once.
 */
export function validateShifts(shifts, { firstMatch = 1, lastMatch = Infinity, names = new Map() } = {}) {
  const problems = [];
  const label = (shift) =>
    `${SLOTS.find((slot) => slot.key === shift.slot)?.label || 'A shift'} Q${shift.start ?? '?'}–Q${shift.end ?? '?'}`;
  const valid = [];
  for (const shift of shifts.map(normalizeShift)) {
    if (!shift.slot) problems.push('Every shift needs a slot.');
    else if (shift.start == null || shift.end == null) problems.push(`${label(shift)} needs a start and an end match.`);
    else if (shift.start > shift.end) problems.push(`${label(shift)} ends before it starts.`);
    else if (shift.start < firstMatch || shift.end > lastMatch)
      problems.push(`${label(shift)} runs past the schedule (Q${firstMatch}–Q${lastMatch}).`);
    else if (!shift.userId) problems.push(`${label(shift)} has no scout.`);
    else valid.push(shift);
  }
  const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const [a, b] = [valid[i], valid[j]];
      if (!overlaps(a, b)) continue;
      if (a.slot === b.slot) problems.push(`${label(a)} overlaps ${label(b)}.`);
      else if (a.userId === b.userId)
        problems.push(`${names.get(a.userId) || 'One scout'} is on ${label(a)} and ${label(b)} at the same time.`);
    }
  }
  return [...new Set(problems)];
}

/**
 * A rotation: matches firstMatch..lastMatch cut into shifts of `length`, each slot handed to its own group of scouts
 * in turn. Scout i works slot i % 6, so a scout always watches the same spot; with twelve scouts each slot has two
 * scouts who take turns, so everyone gets a break of one shift. Returns shifts plus a note when a slot has nobody to
 * hand over to.
 */
export function autoPlan({ scouts = [], length = 10, firstMatch = 1, lastMatch = firstMatch } = {}) {
  const shiftLength = Math.max(1, int(length) || 1);
  if (!scouts.length || lastMatch < firstMatch) return { shifts: [], notes: ['Pick scouts and a match range first.'] };
  const bySlot = SLOTS.map((_, index) => scouts.filter((__, i) => i % SLOTS.length === index));
  const shifts = [];
  let block = 0;
  for (let start = firstMatch; start <= lastMatch; start += shiftLength, block += 1) {
    const end = Math.min(lastMatch, start + shiftLength - 1);
    SLOTS.forEach((slot, index) => {
      const pool = bySlot[index];
      if (!pool.length) return;
      shifts.push({ id: `auto-${slot.key}-${start}`, slot: slot.key, start, end, userId: pool[block % pool.length] });
    });
  }
  const notes = [];
  const empty = SLOTS.filter((_, index) => !bySlot[index].length).map((slot) => slot.label);
  if (empty.length) notes.push(`Nobody covers ${empty.join(', ')}: add more scouts or fill those slots by hand.`);
  const noBreak = SLOTS.filter((_, index) => bySlot[index].length === 1).map((slot) => slot.label);
  if (noBreak.length)
    notes.push(`${noBreak.join(', ')} ${noBreak.length === 1 ? 'has' : 'have'} one scout, with no break.`);
  return { shifts, notes };
}

/** Qualification match number from a TBA match ({ comp_level, match_number }). */
const qualNumber = (match) => (match?.comp_level === 'qm' ? int(match.match_number) : null);

/**
 * The per-match assignments a plan publishes: for every shift and every qualification match in its range, the robot
 * in that slot. Matches missing from the schedule are skipped (and counted).
 */
export function assignmentsFromShifts(shifts, schedule) {
  const byNumber = new Map();
  for (const match of schedule || []) {
    const number = qualNumber(match);
    if (number != null) byNumber.set(number, match);
  }
  const items = [];
  let missing = 0;
  for (const shift of (shifts || []).map(normalizeShift)) {
    const slot = SLOTS.find((entry) => entry.key === shift.slot);
    if (!slot || !shift.userId || shift.start == null || shift.end == null) continue;
    for (let number = shift.start; number <= shift.end; number += 1) {
      const match = byNumber.get(number);
      const teamKey = match?.alliances?.[slot.alliance]?.team_keys?.[slot.index];
      if (!teamKey) {
        missing += 1;
        continue;
      }
      items.push({ match_key: match.key, team_key: teamKey, user_id: shift.userId });
    }
  }
  return { items, missing };
}

/** The qualification range in a schedule: { first, last } (null when there are no qualification matches). */
export function qualRange(schedule) {
  const numbers = (schedule || []).map(qualNumber).filter((n) => n != null);
  return numbers.length ? { first: Math.min(...numbers), last: Math.max(...numbers) } : null;
}

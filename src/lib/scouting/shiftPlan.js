// Shift-based match scouting (Scouting Admin > Assignments). A shift is a run of qualification matches (Q1–Q10, say).
// Inside it, each seat is one scout on one field slot (Red 1 ... Blue 3): they scout whichever robot stands in that
// slot in every match of the shift, then take a break while the next shift's scouts take over. A slot can have several
// scouts (double coverage), one scout can cover several slots (a whole alliance), and a seat with no scout yet is an
// open seat. The plan is stored as one row per seat ({ id, slot, start, end, userId }); rows with the same range make
// up one shift. Publishing turns every seat into ordinary per-match assignments using the TBA schedule, so scouts see
// exactly which robot to watch in each match. Pure, so it can be tested.

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
 * Problems with a plan, as readable sentences: a seat with no slot, a backwards range, a range outside the schedule,
 * and the same scout twice on the same slot at the same time. Several scouts on one slot, one scout on several slots
 * and open seats (no scout yet) are all fine.
 */
export function validateShifts(shifts, { firstMatch = 1, lastMatch = Infinity, names = new Map() } = {}) {
  const problems = [];
  const label = (shift) =>
    `${SLOTS.find((slot) => slot.key === shift.slot)?.label || 'A seat'} Q${shift.start ?? '?'}–Q${shift.end ?? '?'}`;
  const valid = [];
  for (const shift of shifts.map(normalizeShift)) {
    if (!shift.slot) problems.push('Every seat needs a slot.');
    else if (shift.start == null || shift.end == null) problems.push(`${label(shift)} needs a start and an end match.`);
    else if (shift.start > shift.end) problems.push(`${label(shift)} ends before it starts.`);
    else if (shift.start < firstMatch || shift.end > lastMatch)
      problems.push(`${label(shift)} runs past the schedule (Q${firstMatch}–Q${lastMatch}).`);
    else if (shift.userId) valid.push(shift);
  }
  const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;
  for (let i = 0; i < valid.length; i += 1)
    for (let j = i + 1; j < valid.length; j += 1) {
      const [a, b] = [valid[i], valid[j]];
      if (a.slot === b.slot && a.userId === b.userId && overlaps(a, b))
        problems.push(`${names.get(a.userId) || 'One scout'} is on ${label(a)} twice.`);
    }
  return [...new Set(problems)];
}

const slotIndex = (key) => SLOTS.findIndex((slot) => slot.key === key);

/** The plan's seats grouped into shifts (one per match range), in match order and numbered from 1. */
export function groupShifts(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = `${row.start}-${row.end}`;
    if (!groups.has(key)) groups.set(key, { key, start: row.start, end: row.end, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0))
    .map((group, index) => ({
      ...group,
      number: index + 1,
      rows: [...group.rows].sort((a, b) => slotIndex(a.slot) - slotIndex(b.slot))
    }));
}

/**
 * A shift's people in seating order for the roster view (General shifts): everyone's first seat in slot order, then
 * second seats, and so on, so Red 1, Red 2 ... Blue 3, then Red 1 again for a second scout.
 */
export function rosterOf(rows) {
  const bySlot = SLOTS.map((slot) => (rows || []).filter((row) => row.slot === slot.key));
  const rounds = Math.max(0, ...bySlot.map((list) => list.length));
  const roster = [];
  for (let round = 0; round < rounds; round += 1)
    bySlot.forEach((list) => {
      if (list[round]) roster.push(list[round]);
    });
  return roster;
}

/** The slot the nth person on a roster sits in: 1st Red 1, 2nd Red 2 ... 6th Blue 3, 7th Red 1 again. */
export const rosterSlot = (index) => SLOTS[index % SLOTS.length];

/** A shift's seats from a roster (scout ids, null for an open seat), seated in order. */
export function rowsFromRoster(userIds, { start, end, newId }) {
  return (userIds || []).map((userId, index) => ({
    id: newId(),
    slot: rosterSlot(index).key,
    start,
    end,
    userId: userId || null
  }));
}

/**
 * Each scout's exact work from the TBA schedule: for every seat they hold and every qualification match in its range,
 * the match, the robot in their slot and the slot. Map of scout id to a list in match order.
 */
export function scoutMatches(rows, schedule) {
  const byNumber = new Map();
  for (const match of schedule || []) {
    const number = qualNumber(match);
    if (number != null) byNumber.set(number, match);
  }
  const out = new Map();
  for (const row of (rows || []).map(normalizeShift)) {
    const slot = SLOTS.find((entry) => entry.key === row.slot);
    if (!slot || !row.userId || row.start == null || row.end == null) continue;
    for (let number = row.start; number <= row.end; number += 1) {
      const match = byNumber.get(number);
      const teamKey = match?.alliances?.[slot.alliance]?.team_keys?.[slot.index] || null;
      if (!out.has(row.userId)) out.set(row.userId, []);
      out.get(row.userId).push({ number, matchKey: match?.key || null, teamKey, slot: slot.key, slotLabel: slot.label });
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.number - b.number || slotIndex(a.slot) - slotIndex(b.slot));
  return out;
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

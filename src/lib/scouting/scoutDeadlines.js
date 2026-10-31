// The numbers behind the Deadlines page: for each qualification match, who is meant to
// scout each robot, who has handed in a report, and whether the deadline has passed.

import { shortMatchLabel } from '$lib/matches/matchKeys.js';

export const teamNumber = (key) => String(key || '').replace(/^frc/i, '');

export function matchNumber(key) {
  const found = /_qm(\d+)$/i.exec(String(key || ''));
  return found ? Number(found[1]) : null;
}

export const matchLabel = (key) => (matchNumber(key) === null ? String(key || '') : shortMatchLabel(key));

// "6:30pm", "6pm", "18:30", "630 pm" -> { hours, minutes } or null.
export function parseClock(text) {
  const found = /^\s*(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(text || ''));
  if (!found) return null;
  let hours = Number(found[1]);
  const minutes = found[2] === undefined ? 0 : Number(found[2]);
  const meridiem = found[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hours > 23) return null;
  return { hours, minutes };
}

// A local time on a day ("2026-09-20" + "6:30 PM") as a Date, or null if either is unusable.
export function atClock(dayIso, clockText) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayIso || ''));
  const clock = parseClock(clockText);
  if (!day || !clock) return null;
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), clock.hours, clock.minutes);
}

export const dayOf = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const clockOf = (date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const dueText = (date) => `${date.toLocaleDateString([], { weekday: 'short' })} ${clockOf(date)}`;

// TBA gives seconds since the epoch; predicted time follows the event's real pace.
export const scheduledAt = (match) => {
  const seconds = match?.predicted_time || match?.time;
  return seconds ? new Date(seconds * 1000) : null;
};

const slotsOf = (match) => [
  ...(match.alliances?.red?.team_keys || []).map((teamKey) => ({ teamKey, alliance: 'red' })),
  ...(match.alliances?.blue?.team_keys || []).map((teamKey) => ({ teamKey, alliance: 'blue' }))
];

// One row per match. A slot is "done" once anyone has reported that robot in that match;
// "late" when its deadline has passed and the assigned scout has not; "missed" when the
// assigned scout has since reported a later match (they moved on without it).
export function buildMatchRows({
  matches = [],
  assignments = [],
  reports = [],
  deadlines = new Map(),
  now = new Date()
}) {
  const assigned = new Map(
    assignments.filter((row) => row.assigned_user).map((row) => [`${row.match_key}|${row.team_key}`, row])
  );
  const reported = new Set(reports.map((row) => `${row.match_key}|${row.team_key}`));
  const latestByScout = new Map();
  for (const row of reports) {
    const number = matchNumber(row.match_key);
    if (row.created_by && number !== null && number > (latestByScout.get(row.created_by) || 0))
      latestByScout.set(row.created_by, number);
  }

  return matches.map((match) => {
    const number = match.match_number ?? matchNumber(match.key);
    const due = deadlines.get(match.key) ? new Date(deadlines.get(match.key)) : null;
    const pastDue = due !== null && now > due;
    const slots = slotsOf(match).map((slot) => {
      const owner = assigned.get(`${match.key}|${slot.teamKey}`);
      let status;
      const slotKey = `${match.key}|${slot.teamKey}`;
      if (reported.has(slotKey)) status = 'done';
      else if (!owner) status = 'unassigned';
      else if (pastDue) status = 'late';
      else if ((latestByScout.get(owner.assigned_user) || 0) > number) status = 'missed';
      else status = 'pending';
      return {
        ...slot,
        scoutId: owner?.assigned_user || null,
        scoutName: owner?.user_name || null,
        status,
        hasScout: Boolean(owner)
      };
    });
    const count = (status) => slots.filter((slot) => slot.status === status).length;
    const counts = {
      done: count('done'),
      late: count('late'),
      missed: count('missed'),
      pending: count('pending'),
      unassigned: count('unassigned')
    };
    const state = counts.late
      ? 'late'
      : counts.missed
        ? 'missed'
        : counts.done === slots.length && slots.length
          ? 'done'
          : due
            ? 'open'
            : 'none';
    return {
      key: match.key,
      number,
      label: matchLabel(match.key),
      scheduledAt: scheduledAt(match),
      dueAt: due,
      slots,
      counts,
      state
    };
  });
}

export function summarize(rows) {
  return {
    matches: rows.length,
    withDeadline: rows.filter((row) => row.dueAt).length,
    late: rows.filter((row) => row.counts.late).length,
    missed: rows.filter((row) => row.counts.missed).length,
    done: rows.filter((row) => row.state === 'done').length,
    lateSlots: rows.reduce((sum, row) => sum + row.counts.late, 0),
    missedSlots: rows.reduce((sum, row) => sum + row.counts.missed, 0)
  };
}

// Everything each scout still owes, for the "who to chase" view.
export function owedByScout(rows) {
  const byScout = new Map();
  for (const row of rows) {
    for (const slot of row.slots) {
      if (slot.status !== 'late' && slot.status !== 'missed') continue;
      const name = slot.scoutName || 'Unknown scout';
      if (!byScout.has(slot.scoutId || name)) byScout.set(slot.scoutId || name, { id: slot.scoutId, name, items: [] });
      byScout.get(slot.scoutId || name).items.push({
        match: row.label,
        number: row.number,
        teamKey: slot.teamKey,
        status: slot.status,
        dueAt: row.dueAt
      });
    }
  }
  return [...byScout.values()]
    .map((scout) => ({ ...scout, items: scout.items.sort((a, b) => a.number - b.number) }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

// The deadlines to write for matches `from` through `to`:
//   mode "after": each match's scheduled start plus `offsetMinutes` (skips matches with no schedule)
//   mode "at":    one fixed moment (`at`, a Date) for all of them
export function deadlinesForRange(rows, { from, to, mode, offsetMinutes = 0, at = null }) {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const items = [];
  let skipped = 0;
  for (const row of rows) {
    if (row.number < low || row.number > high) continue;
    const moment =
      mode === 'at' ? at : row.scheduledAt ? new Date(row.scheduledAt.getTime() + offsetMinutes * 60000) : null;
    if (!moment) {
      skipped += 1;
      continue;
    }
    items.push({ match_key: row.key, due_at: moment.toISOString() });
  }
  return { items, skipped };
}

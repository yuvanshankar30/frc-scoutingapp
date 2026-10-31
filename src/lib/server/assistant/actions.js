// Actions the assistant can PROPOSE. It never writes anything itself: each proposal is a description of one
// request to an existing app endpoint (the same ones the Picklist and note forms use, with their validation and
// permission checks), shown to the person with a Confirm button. The browser sends it with the person's own
// sign-in only when they confirm. Anything the model puts in the arguments is validated here first, and the
// browser refuses any request that is not to one of ALLOWED_PATHS.

import { ALLOWED_PATHS, PREV_ID } from '$lib/assistant/allowedPaths.js';
export { ALLOWED_PATHS };
export const MAX_PROPOSALS = 5;
const MAX_NOTE = 600;
const TEAM = /^frc\d{1,5}$/;

const clean = (text, max = MAX_NOTE) =>
  String(text ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const number = (key) => key.replace(/^frc/, '');

// A proposal is one or more requests, sent in order when the person confirms (it stops at the first failure).
function proposal(kind, summary, path, body, more = []) {
  return {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind,
    summary,
    requests: [
      { method: 'POST', path, body },
      ...more.map((m) => ({ method: 'POST', path: m.path ?? path, body: m.body }))
    ]
  };
}
export const MAX_BATCH = 12;

/** One builder per action. Each returns { proposal } or { error }. `rows` is the current picklist (with ids). */
export const BUILDERS = {
  add_note({ teamKey, matchKey, note, impact }) {
    const text = clean(note);
    if (!TEAM.test(teamKey)) return { error: 'A valid team number is required.' };
    if (!matchKey) return { error: 'A match is required (for example qm12).' };
    if (!text) return { error: 'The note text is empty.' };
    const ranking_impact = [-2, -1, 0, 1, 2].includes(Number(impact)) ? Number(impact) : 0;
    const matchNumber = Number(String(matchKey).match(/qm(\d+)$/)?.[1]) || null;
    return {
      proposal: proposal(
        'add_note',
        `Add a scout note on team ${number(teamKey)} for ${matchKey.replace(/^.*_/, '')}${ranking_impact ? ` (ranking impact ${ranking_impact > 0 ? '+' : ''}${ranking_impact})` : ''}: "${text}"`,
        '/notescout',
        {
          action: 'save-note',
          match_key: matchKey,
          match_number: matchNumber,
          team_key: teamKey,
          notes: text,
          ranking_impact
        }
      )
    };
  },

  picklist_add({ eventKey, teamKey, note, rows }) {
    if (!TEAM.test(teamKey)) return { error: 'A valid team number is required.' };
    if (rows.some((r) => r.team_key === teamKey))
      return { error: `Team ${number(teamKey)} is already on the picklist.` };
    const text = clean(note);
    // The note needs the id of the row the add creates, which only exists once the add has run: the browser
    // fills PREV_ID in from the add's response.
    const more = text ? [{ body: { action: 'note', event_key: eventKey, id: PREV_ID, note: text } }] : [];
    return {
      proposal: proposal(
        'picklist_add',
        `Add team ${number(teamKey)} to the end of the picklist (position ${rows.length + 1})${text ? ` with the note "${text}"` : ''}`,
        '/api/scouting-picklist',
        { action: 'add', event_key: eventKey, team_key: teamKey, team_number: Number(number(teamKey)) },
        more
      )
    };
  },

  picklist_remove({ eventKey, teamKey, rows }) {
    const row = rows.find((r) => r.team_key === teamKey);
    if (!row?.id) return { error: `Team ${number(teamKey || '')} is not on the picklist.` };
    return {
      proposal: proposal(
        'picklist_remove',
        `Remove team ${number(teamKey)} from the picklist`,
        '/api/scouting-picklist',
        { action: 'remove', event_key: eventKey, id: row.id }
      )
    };
  },

  picklist_note({ eventKey, teamKey, note, rows }) {
    const row = rows.find((r) => r.team_key === teamKey);
    if (!row?.id) return { error: `Team ${number(teamKey || '')} is not on the picklist.` };
    const text = clean(note);
    return {
      proposal: proposal(
        'picklist_note',
        text
          ? `Set the picklist note for team ${number(teamKey)}: "${text}"`
          : `Clear the picklist note for team ${number(teamKey)}`,
        '/api/scouting-picklist',
        { action: 'note', event_key: eventKey, id: row.id, note: text }
      )
    };
  },

  picklist_add_many({ eventKey, teamKeys, rows }) {
    const wanted = [...new Set((teamKeys || []).filter((k) => TEAM.test(k)))];
    if (!wanted.length) return { error: 'No valid team numbers were given.' };
    const fresh = wanted.filter((k) => !rows.some((r) => r.team_key === k));
    if (!fresh.length) return { error: 'All of those teams are already on the picklist.' };
    if (fresh.length > MAX_BATCH) return { error: `Add at most ${MAX_BATCH} teams at a time.` };
    const body = (k) => ({ action: 'add', event_key: eventKey, team_key: k, team_number: Number(number(k)) });
    const skipped = wanted.length - fresh.length;
    return {
      proposal: proposal(
        'picklist_add_many',
        `Add ${fresh.length} team${fresh.length === 1 ? '' : 's'} to the end of the picklist: ${fresh.map(number).join(', ')}${skipped ? ` (${skipped} already on it)` : ''}`,
        '/api/scouting-picklist',
        body(fresh[0]),
        fresh.slice(1).map((k) => ({ body: body(k) }))
      )
    };
  },

  picklist_reorder({ eventKey, teamKeys, rows }) {
    const named = [...new Set((teamKeys || []).filter((k) => TEAM.test(k)))];
    const known = named.filter((k) => rows.some((r) => r.team_key === k));
    if (!known.length) return { error: 'None of those teams are on the picklist.' };
    const rest = [...rows].sort((a, b) => a.position - b.position).filter((r) => !known.includes(r.team_key));
    const ordered = [...known.map((k) => rows.find((r) => r.team_key === k)), ...rest];
    const same = ordered.every((r, i) => r.id === [...rows].sort((a, b) => a.position - b.position)[i].id);
    if (same) return { error: 'The picklist is already in that order.' };
    return {
      proposal: proposal(
        'picklist_reorder',
        `Put ${known.map(number).join(', ')} at the top of the picklist in that order${rest.length ? `, keeping the other ${rest.length} in their current order` : ''}`,
        '/api/scouting-picklist',
        { action: 'reorder', event_key: eventKey, ordered_ids: ordered.map((r) => r.id) }
      )
    };
  },

  picklist_move({ eventKey, teamKey, position, rows }) {
    const ordered = [...rows].sort((a, b) => a.position - b.position);
    const from = ordered.findIndex((r) => r.team_key === teamKey);
    if (from < 0) return { error: `Team ${number(teamKey || '')} is not on the picklist.` };
    const target = Math.min(Math.max(1, Math.trunc(Number(position)) || 0), ordered.length);
    if (!Number.isFinite(target) || target < 1) return { error: 'position must be a number from 1.' };
    if (target - 1 === from) return { error: `Team ${number(teamKey)} is already at position ${target}.` };
    const [moved] = ordered.splice(from, 1);
    ordered.splice(target - 1, 0, moved);
    return {
      proposal: proposal(
        'picklist_move',
        `Move team ${number(teamKey)} from position ${from + 1} to ${target} on the picklist`,
        '/api/scouting-picklist',
        { action: 'reorder', event_key: eventKey, ordered_ids: ordered.map((r) => r.id) }
      )
    };
  }
};

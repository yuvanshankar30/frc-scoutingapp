// Match keys on scouting reports are not always TBA keys. Reports typed or imported over the
// years say "12", "qm12", "Qual 64" or "2026cc_Quals 70" for the same kind of thing. This
// turns any of those into the canonical "<event>_qm<number>" so a report can be matched to
// its match; anything that is not clearly a qualification match is left alone.
import { canonicalScoutMatchSuffix } from '$lib/scouting/scoutAssignmentCompletion.js';

/** What a stored match key must look like: `<event>_qm12`, `<event>_sf2m1`, `<event>_f1m2`. Mirrors the
 * `match_scout_entries_match_key_canonical` check in the database. */
export const MATCH_KEY_PATTERN = /^[0-9a-z]+_(qm|ef|qf|sf|f|pm)[0-9]+(m[0-9]+)?$/;

/**
 * The stored key for whatever a scout typed in the match box ("12", "Quals 12", "Q12", "sf2m1",
 * "Finals 2", "2026cc_qm12"), or null when it isn't a match we can read.
 */
export function canonicalMatchKey(raw, eventKey) {
  const event = String(eventKey || '')
    .trim()
    .toLowerCase();
  const suffix = canonicalScoutMatchSuffix(raw);
  return event && suffix ? `${event}_${suffix}` : null;
}

/** The short form a scout types back into the match box: "12" for a qual, "sf2m1" for a playoff. */
export function matchInputValue(key) {
  const suffix = canonicalScoutMatchSuffix(key);
  if (!suffix) return String(key ?? '');
  return suffix.startsWith('qm') ? suffix.slice(2) : suffix;
}

export function qualNumber(key) {
  const tail = String(key ?? '')
    .split('_')
    .at(-1)
    .trim();
  const found = /^(?:q(?:m|ual|uals)?\s*)?(\d+)$/i.exec(tail);
  return found ? Number(found[1]) : null;
}

export function canonicalReportKey(key, eventKey) {
  const number = qualNumber(key);
  return number === null || !eventKey ? key : `${eventKey}_qm${number}`;
}

export const canonicalReports = (reports, eventKey) =>
  (reports || []).map((report) => {
    const match_key = canonicalReportKey(report.match_key, eventKey);
    return match_key === report.match_key ? report : { ...report, match_key };
  });

// Play order of comp levels. TBA's own level codes; anything unknown sorts last.
export const LEVEL_ORDER = { pm: 0, qm: 1, ef: 2, qf: 3, sf: 4, f: 5 };
const levelRank = (level) => LEVEL_ORDER[String(level || '').toLowerCase()] ?? 99;
const LEVEL_NAMES = { ef: 'Eighth-final', qf: 'Quarterfinal', sf: 'Semifinal', f: 'Final' };

/** Two TBA match objects in play order: comp level, then set, then match number. */
export function compareTbaMatches(a, b) {
  return (
    levelRank(a?.comp_level) - levelRank(b?.comp_level) ||
    (a?.set_number || 0) - (b?.set_number || 0) ||
    (a?.match_number || 0) - (b?.match_number || 0)
  );
}

/** [level, set or qual number, match] for any match key a scout might have typed; unreadable keys sort last. */
export function matchKeyOrder(matchKey) {
  const practice = String(matchKey || '')
    .split('_')
    .pop()
    .trim()
    .toLowerCase()
    .match(/^pm(\d+)$/);
  if (practice) return [LEVEL_ORDER.pm, Number(practice[1]), 0];
  const found = (canonicalScoutMatchSuffix(matchKey) || '').match(/^(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (!found) return [99, 0, 0];
  return [LEVEL_ORDER[found[1]], Number(found[2]), Number(found[3] || 0)];
}

/** Two match keys in play order (qualifications, then playoffs in field order). */
export function compareMatchKeys(left, right) {
  const a = matchKeyOrder(left);
  const b = matchKeyOrder(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** "Qual 12", "Semifinal 2 · Match 1", "Final 2", "Practice 4"; a key we can't read is shown as typed. */
export function matchLabel(matchKey) {
  const practice = String(matchKey || '')
    .split('_')
    .pop()
    .toLowerCase()
    .match(/^pm(\d+)$/);
  if (practice) return `Practice ${practice[1]}`;
  const found = (canonicalScoutMatchSuffix(matchKey) || '').match(/^(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (!found) return String(matchKey || '').trim() || 'Match';
  const [, level, set, match] = found;
  if (level === 'qm') return `Qual ${set}`;
  if (level === 'f') return `Final ${match || set}`;
  return `${LEVEL_NAMES[level]} ${set}${match ? ` · Match ${match}` : ''}`;
}

/** "Q12", "SF2-1", "F1-2", "PM4": short enough for a chart axis or a schedule row. */
export function shortMatchLabel(matchKey) {
  const suffix =
    canonicalScoutMatchSuffix(matchKey) ||
    String(matchKey || '')
      .split('_')
      .pop();
  const found = suffix.match(/^(qm|pm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/);
  if (!found) return String(suffix || '').toUpperCase();
  if (found[1] === 'qm') return `Q${found[2]}`;
  return `${found[1].toUpperCase()}${found[2]}${found[3] ? `-${found[3]}` : ''}`;
}

/** The key suffix for a TBA match object: qm12, sf2m1, f1m2, pm4. */
export function tbaMatchSuffix(match) {
  const level = String(match?.comp_level || '').toLowerCase();
  if (level === 'qm' || level === 'pm') return `${level}${match?.match_number ?? ''}`;
  return `${level}${match?.set_number ?? ''}m${match?.match_number ?? ''}`;
}

/** matchLabel for a TBA match object ("Test match 3" for a prediction-market test match). */
export function tbaMatchLabel(match) {
  if (String(match?.comp_level || '').toLowerCase() === 'test') return `Test match ${match?.match_number ?? ''}`.trim();
  if (!match?.comp_level) return 'Match';
  return matchLabel(tbaMatchSuffix(match));
}

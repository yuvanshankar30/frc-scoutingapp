// TBA event keys are the year plus a lowercase code ("2026mttd"). Match keys, the
// `event_key` columns and TBA URLs all use that lowercase form, so a code typed any
// other way is normalised to it; the UI shows it upper-case.
const EVENT_CODE_PATTERN = /^\d{4}[a-z][a-z0-9]{1,27}$/;

export function normalizeEventCode(input) {
  const code = String(input ?? '')
    .trim()
    .toLowerCase();
  return EVENT_CODE_PATTERN.test(code) ? code : null;
}

export function displayEventCode(key) {
  return String(key ?? '')
    .trim()
    .toUpperCase();
}

export function escapeMatchKeyPrefix(eventKey) {
  const clean = normalizeEventCode(eventKey);
  if (!clean) return null;
  return `${clean.replace(/[\\%_]/g, '\\$&')}\\_%`;
}

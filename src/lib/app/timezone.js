// Dates and times are shown in the team's timezone (set in first-run setup, changeable under
// Scouting Admin > Team settings), so everyone at an event sees the same clock whatever their
// phone is set to. Until the settings load, the browser's own timezone (or UTC on the server) is used.

const fallbackTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

let appTimeZone = fallbackTimeZone();

/** True for an IANA timezone name this runtime understands, like "America/Chicago". */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function setAppTimeZone(timeZone) {
  appTimeZone = isValidTimeZone(timeZone) ? timeZone : fallbackTimeZone();
}

export const getAppTimeZone = () => appTimeZone;

const formatterCache = new Map();

function normalizeDate(value, { preserveDateOnly = false } = {}) {
  if (preserveDateOnly && typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0));
    }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getFormatter(timeZone, options = {}) {
  const entries = Object.entries(options).sort(([left], [right]) => left.localeCompare(right));
  const key = `${timeZone}:${JSON.stringify(entries)}`;
  if (!formatterCache.has(key)) formatterCache.set(key, new Intl.DateTimeFormat('en-US', { timeZone, ...options }));
  return formatterCache.get(key);
}

export function formatInTimeZone(value, timeZone = appTimeZone, options = {}) {
  const date = normalizeDate(value);
  if (!date) return '';
  try {
    return getFormatter(timeZone, options).format(date);
  } catch {
    return '';
  }
}

export function formatLocal(value, options = {}) {
  return formatInTimeZone(value, appTimeZone, options);
}

export function formatLocalDate(value, options = {}) {
  const date = normalizeDate(value, { preserveDateOnly: true });
  if (!date) return '';
  try {
    return getFormatter(appTimeZone, { year: 'numeric', month: 'short', day: 'numeric', ...options }).format(date);
  } catch {
    return '';
  }
}

export function formatLocalTime(value, options = {}) {
  return formatLocal(value, { hour: 'numeric', minute: '2-digit', ...options });
}

export function formatLocalDateTime(value, options = {}) {
  return formatLocal(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options
  });
}

export function formatLocalTimeWithZone(value, options = {}) {
  return formatLocalTime(value, { timeZoneName: 'short', ...options });
}

export function formatLocalDateTimeWithZone(value, options = {}) {
  return formatLocalDateTime(value, { timeZoneName: 'short', ...options });
}

/** Today's date in the team's timezone, as YYYY-MM-DD. */
export function todayInAppTimeZone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone }).format(now);
}

/** The UTC offset of the team's timezone at `instant`, in minutes (e.g. -420 for PDT). */
export function timeZoneOffsetMinutes(instant, timeZone = appTimeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(instant);
  const label = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(label);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '-' ? -minutes : minutes;
}

import { getAppTimeZone, timeZoneOffsetMinutes } from '$lib/app/timezone.js';

const FORMULA_PREFIX = /^(?:[\t\r]|[\s]*[=+\-@|])/;

function scalarValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function csvCell(value) {
  let text = scalarValue(value);
  // CSVs are commonly opened in Excel/Sheets. Prevent user-entered notes
  // from becoming executable spreadsheet formulas on open.
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function matchScoutingRowsToCsv(rows = []) {
  const discovered = new Set(rows.flatMap((row) => Object.keys(row || {})));
  const preferred = ['event_key', 'match_key', 'team_key'];
  const columns = [
    ...preferred.filter((column) => discovered.has(column)),
    ...[...discovered].filter((column) => !preferred.includes(column)).sort()
  ];
  return `\uFEFF${[
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))
  ].join('\r\n')}\r\n`;
}

// Turns a `YYYY-MM-DD` calendar day (from a plain <input type="date">, read as a day in the team's timezone)
// into the UTC instant range that day spans, for a created_at >= start AND created_at < end query. The offset is
// read from Intl for that date, so it stays right across daylight saving changes (it is sampled at UTC midnight, so
// it can be an hour off on the one or two days a year the clocks change, which is fine for an export).
export function localDayRangeUtc(dateStr, timeZone = getAppTimeZone()) {
  const [year, month, day] = String(dateStr || '')
    .split('-')
    .map(Number);
  if (!year || !month || !day) throw new Error('date must be in YYYY-MM-DD format');
  const naiveUtcMidnight = Date.UTC(year, month - 1, day);
  const offsetMinutes = timeZoneOffsetMinutes(new Date(naiveUtcMidnight), timeZone);
  const startUtcMs = naiveUtcMidnight - offsetMinutes * 60 * 1000;
  return {
    start: new Date(startUtcMs).toISOString(),
    end: new Date(startUtcMs + 24 * 60 * 60 * 1000).toISOString()
  };
}

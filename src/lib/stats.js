// Small number helpers shared by the scouting, vision and assistant code.
// Missing data stays null (shown as "—"), never 0.

export const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

/** `value` rounded to `places` decimals, or null when it isn't a finite number. */
export function round(value, places = 2) {
  return isNum(value) ? Math.round(value * 10 ** places) / 10 ** places : null;
}

/** The mean of the finite numbers in `values`, or null when there are none. */
export function mean(values) {
  const usable = (values || []).filter(isNum);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

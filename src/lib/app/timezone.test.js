import { afterEach, describe, expect, it } from 'vitest';
import {
  formatLocalDate,
  formatLocalDateTimeWithZone,
  formatLocalTimeWithZone,
  getAppTimeZone,
  isValidTimeZone,
  setAppTimeZone,
  timeZoneOffsetMinutes,
  todayInAppTimeZone
} from './timezone.js';

afterEach(() => setAppTimeZone('UTC'));

describe('team timezone', () => {
  it('accepts real IANA names and falls back on anything else', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    setAppTimeZone('America/Chicago');
    expect(getAppTimeZone()).toBe('America/Chicago');
    setAppTimeZone('Not/AZone');
    expect(getAppTimeZone()).not.toBe('Not/AZone');
  });

  it('formats in the team timezone, with its abbreviation', () => {
    setAppTimeZone('America/New_York');
    const instant = Date.UTC(2026, 2, 14, 18, 30);
    expect(formatLocalTimeWithZone(instant)).toBe('2:30 PM EDT');
    expect(formatLocalDateTimeWithZone(instant)).toContain('Mar 14, 2026');
    expect(formatLocalDate('2026-03-14')).toBe('Mar 14, 2026');
  });

  it("gives today's date and the offset in the team timezone", () => {
    setAppTimeZone('Asia/Tokyo');
    expect(todayInAppTimeZone(new Date(Date.UTC(2026, 0, 1, 20)))).toBe('2026-01-02');
    expect(timeZoneOffsetMinutes(new Date(Date.UTC(2026, 0, 1)), 'Asia/Tokyo')).toBe(540);
    expect(timeZoneOffsetMinutes(new Date(Date.UTC(2026, 6, 1)), 'America/Los_Angeles')).toBe(-420);
  });
});

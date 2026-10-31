import { describe, expect, it } from 'vitest';
import { isNum, mean, round } from './stats.js';

describe('stats', () => {
  it('rounds finite numbers and leaves missing values as null, never 0', () => {
    expect(round(1.23456)).toBe(1.23);
    expect(round(1.25, 1)).toBe(1.3);
    expect(round(null)).toBeNull();
    expect(round(undefined)).toBeNull();
    expect(round(Number.NaN)).toBeNull();
    expect(round('3')).toBeNull();
  });

  it('averages only the finite numbers', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([1, null, 3, Number.NaN])).toBe(2);
    expect(mean([])).toBeNull();
    expect(mean(null)).toBeNull();
    expect(isNum(0)).toBe(true);
    expect(isNum(Infinity)).toBe(false);
  });
});

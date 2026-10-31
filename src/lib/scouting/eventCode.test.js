import { describe, expect, it } from 'vitest';
import { displayEventCode, escapeMatchKeyPrefix, normalizeEventCode } from './eventCode.js';

describe('normalizeEventCode', () => {
  it('lower-cases and trims a code', () => {
    expect(normalizeEventCode('  2026MTTD ')).toBe('2026mttd');
    expect(normalizeEventCode('2026cc')).toBe('2026cc');
    expect(normalizeEventCode('2026ccprescouting')).toBe('2026ccprescouting');
    expect(normalizeEventCode('2026testing')).toBe('2026testing');
  });
  it('rejects anything that is not a year plus a code', () => {
    for (const bad of ['', 'mttd', '2026', '2026 mttd', '2026-mttd', '2026_qm1', '20266mttd', null, undefined]) {
      expect(normalizeEventCode(bad)).toBeNull();
    }
  });
});

describe('displayEventCode', () => {
  it('shows the code upper-case', () => {
    expect(displayEventCode('2026mttd')).toBe('2026MTTD');
    expect(displayEventCode(null)).toBe('');
  });
});

describe('escapeMatchKeyPrefix', () => {
  it('escapes the underscore separator so LIKE/ILIKE only matches "<event>_*"', () => {
    expect(escapeMatchKeyPrefix('2026MTTD')).toBe('2026mttd\\_%');
    expect(escapeMatchKeyPrefix('2026cc')).toBe('2026cc\\_%');
  });
  it('returns null for wildcard or invalid event keys', () => {
    expect(escapeMatchKeyPrefix('%')).toBeNull();
    expect(escapeMatchKeyPrefix('2026%')).toBeNull();
    expect(escapeMatchKeyPrefix('2026_qm1')).toBeNull();
    expect(escapeMatchKeyPrefix('')).toBeNull();
  });
});

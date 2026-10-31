import { describe, expect, it } from 'vitest';
import { firstName, greetingFor, scoutIdentity } from './scoutIdentity.js';

describe('scoutIdentity', () => {
  it('greets by time of day', () => {
    expect(greetingFor(new Date(2026, 9, 22, 8))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 9, 22, 13))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 9, 22, 19))).toBe('Good evening');
    expect(greetingFor(new Date(2026, 9, 22, 2))).toBe('Up late');
  });

  it('uses the first name, or the email before the @', () => {
    expect(firstName({ full_name: 'Sam Rivera' })).toBe('Sam');
    expect(firstName({ email: 'alex@example.com' })).toBe('Alex');
    expect(firstName(null)).toBe('Scout');
  });

  it('lists scout roles and picks the kind they scout', () => {
    const me = scoutIdentity(
      { full_name: 'A B', roster_keys: ['Performance Scout Member', 'Scouting Lead'] },
      new Date(2026, 9, 22, 9)
    );
    expect(me).toMatchObject({
      firstName: 'A',
      greeting: 'Good morning',
      kind: 'performance',
      roles: ['Performance scout'],
      isLead: true
    });
    expect(scoutIdentity({ roster_keys: [] }).roles).toEqual([]);
  });
});

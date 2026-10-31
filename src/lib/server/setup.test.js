import { describe, expect, it } from 'vitest';
import { tokenMatches, validateAdminInput } from './setup.js';

describe('first-run setup checks', () => {
  it('needs the exact setup token, and never matches when none is configured', () => {
    expect(tokenMatches('s3cret-token', 's3cret-token')).toBe(true);
    expect(tokenMatches('s3cret-tokeN', 's3cret-token')).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches(undefined, undefined)).toBe(false);
  });

  it('checks the first admin account', () => {
    expect(validateAdminInput({ fullName: 'Sam', email: 'SAM@Example.org ', password: 'longenough' })).toEqual({
      value: { fullName: 'Sam', email: 'sam@example.org', password: 'longenough' },
      error: null
    });
    expect(validateAdminInput({ fullName: '', email: 'a@b.co', password: 'longenough' }).error).toMatch(/name/);
    expect(validateAdminInput({ fullName: 'Sam', email: 'nope', password: 'longenough' }).error).toMatch(/email/);
    expect(validateAdminInput({ fullName: 'Sam', email: 'a@b.co', password: 'short' }).error).toMatch(/8/);
  });
});

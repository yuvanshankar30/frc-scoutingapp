import { describe, it, expect } from 'vitest';
import { getRoleDerivedPermissions, hasPermission, isDev, normalizePermissions } from './permissions.js';

describe('hasPermission', () => {
  it('returns false for a missing user', () => {
    expect(hasPermission(null, 'CAN_SEE_ROUTES')).toBe(false);
  });

  it('grants everything to admins', () => {
    expect(hasPermission({ role: 'admin' }, 'DATA_SCOUT_ADMIN')).toBe(true);
  });

  it('treats general_role "none" as pending approval', () => {
    expect(hasPermission({ general_role: 'none' }, 'CAN_SEE_ROUTES')).toBe(false);
    expect(hasPermission({ general_role: 'member' }, 'CAN_SEE_ROUTES')).toBe(true);
  });

  it('falls back to the explicit permissions array', () => {
    expect(hasPermission({ permissions: ['CAN_SEE_ROUTES'] }, 'CAN_SEE_ROUTES')).toBe(true);
  });

  it('grants scouting admin through a lead competition role', () => {
    expect(hasPermission({ roster_keys: ['Scouting Lead'] }, 'DATA_SCOUT_ADMIN')).toBe(true);
    expect(hasPermission({ roster_keys: ['Data Scout Member'] }, 'DATA_SCOUT_ADMIN')).toBe(false);
  });

  it('gives a Competition Lead every permission', () => {
    expect(hasPermission({ roster_keys: ['Competition Lead'] }, 'BAN_USERS')).toBe(true);
    expect(hasPermission({ team_role: 'Competition Lead' }, 'BAN_USERS')).toBe(true);
  });

  it('denies everything to banned users, even admins', () => {
    expect(hasPermission({ role: 'admin', banned: true }, 'CAN_SEE_ROUTES')).toBe(false);
  });
});

describe('getRoleDerivedPermissions', () => {
  it('merges general role and roster key permissions', () => {
    const perms = getRoleDerivedPermissions({ general_role: 'member', roster_keys: ['Robot Scout Member'] });
    expect([...perms].sort()).toEqual(['CAN_SEE_ROUTES', 'DATA_SCOUT_MEMBER']);
  });

  it('ignores unknown roles', () => {
    expect([...getRoleDerivedPermissions({ general_role: 'wizard', roster_keys: ['Nope'] })]).toEqual([]);
  });
});

describe('isDev and normalizePermissions', () => {
  it('needs is_dev and no ban', () => {
    expect(isDev({ is_dev: true })).toBe(true);
    expect(isDev({ is_dev: true, banned: true })).toBe(false);
  });

  it('handles arrays, scalars and empty input', () => {
    expect(normalizePermissions(['A', 1])).toEqual(['A', '1']);
    expect(normalizePermissions('A')).toEqual(['A']);
    expect(normalizePermissions(null)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  PERMISSION_KEYS,
  permissionGroups,
  permissionsBeyond,
  rolePermissionsForProfile,
  searchPermissions,
  validateRoleInput
} from './accessRoles.js';

describe('access roles', () => {
  it('groups the catalog and keeps every key once', () => {
    const groups = permissionGroups();
    expect(groups.map((group) => group.group)).toEqual(['Scouting Admin', 'People', 'Data', 'Scouting']);
    expect(groups.flatMap((group) => group.permissions.map((p) => p.key))).toEqual(PERMISSION_KEYS);
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    expect(PERMISSION_KEYS).not.toContain('CAN_SEE_ROUTES');
  });

  it('searches labels, descriptions and groups', () => {
    expect(searchPermissions('export').map((p) => p.key)).toEqual(['EXPORT_DATA']);
    expect(searchPermissions('people').length).toBeGreaterThan(3);
    expect(searchPermissions('').length).toBe(PERMISSION_KEYS.length);
  });

  it('validates a role and refuses unknown permissions and the Member name', () => {
    expect(validateRoleInput({ name: ' Pit lead ', permissions: ['EXPORT_DATA', 'MANAGE_EVENT'] })).toEqual({
      error: null,
      value: { name: 'Pit lead', description: '', permissions: ['MANAGE_EVENT', 'EXPORT_DATA'] }
    });
    expect(validateRoleInput({ name: '' }).error).toMatch(/name/);
    expect(validateRoleInput({ name: 'member' }).error).toMatch(/Member/);
    expect(validateRoleInput({ name: 'X', permissions: ['CAN_SEE_ROUTES'] }).error).toMatch(/Unknown/);
  });

  it('rewrites a holder’s permissions from the role and keeps approval', () => {
    expect(rolePermissionsForProfile(['CAN_SEE_ROUTES', 'DELETE_DATA'], { permissions: ['EXPORT_DATA'] })).toEqual([
      'CAN_SEE_ROUTES',
      'EXPORT_DATA'
    ]);
    expect(rolePermissionsForProfile(['CAN_SEE_ROUTES', 'EXPORT_DATA'], null)).toEqual(['CAN_SEE_ROUTES']);
    expect(rolePermissionsForProfile([], { permissions: ['EXPORT_DATA'] })).toEqual(['EXPORT_DATA']);
  });

  it('never lets someone hand out a permission they lack', () => {
    expect(permissionsBeyond(['EXPORT_DATA'], ['EXPORT_DATA', 'DELETE_DATA'])).toEqual(['DELETE_DATA']);
    expect(permissionsBeyond([], ['DELETE_DATA'], { isAdmin: true })).toEqual([]);
  });
});

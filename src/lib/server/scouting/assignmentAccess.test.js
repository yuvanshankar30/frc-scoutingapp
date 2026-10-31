import { describe, expect, it } from 'vitest';
import { computeAssignmentAccess } from './assignmentAccess.js';

describe('assignment access', () => {
  it('lets admins and panel leads publish, and scout-role holders be assigned', () => {
    expect(computeAssignmentAccess({ role: 'admin', permissions: [] }, []).canEditData).toBe(true);
    expect(computeAssignmentAccess({ role: 'member', permissions: ['VIEW_ADMIN_PANEL'] }, []).canEditNote).toBe(true);
    const member = computeAssignmentAccess({ role: 'member', permissions: ['DATA_SCOUT_MEMBER'] }, []);
    expect(member.canEditData).toBe(false);
    expect(member.canAssignData).toBe(true);
  });

  it('gives a banned caller nothing, whatever roles or keys they still hold', () => {
    const banned = computeAssignmentAccess(
      { role: 'admin', banned: true, permissions: ['VIEW_ADMIN_PANEL', 'DATA_SCOUT_ADMIN'] },
      ['Scouting Admin']
    );
    expect(Object.values(banned).filter((value) => value === true)).toEqual([]);
  });
});

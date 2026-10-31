import { describe, expect, it } from 'vitest';
import {
  COMPETITION_ROLES,
  SCOUTING_ADMIN_ROLES,
  competitionRoleLabel,
  hasScoutingAdmin,
  holdsScoutingAdminRole,
  isCompetitionLead,
  isScoutEligibleKey,
  orderCompetitionRoles
} from './competitionRoles.js';

describe('competition roles', () => {
  it('lists every role once, with the pit crew named by discipline and the retired roles gone', () => {
    expect(new Set(COMPETITION_ROLES).size).toBe(COMPETITION_ROLES.length);
    for (const role of [
      'Competition Lead',
      'Driver',
      'Drive Team',
      'Mechanical Pit',
      'Electrical Pit',
      'Software Pit',
      'Pit Coach',
      'Pit Mentor',
      'Strategy Lead',
      'Match Recording',
      'Strat Coach',
      'Picklist 1 Lead',
      'Picklist 2 Lead',
      'Picklist Team',
      'Scouting Lead',
      'Drive Team Mentor'
    ]) {
      expect(COMPETITION_ROLES).toContain(role);
    }
    for (const retired of ['Scouting Admin', 'Data Scout Lead', 'Note Scout Lead', 'Note Scout Member']) {
      expect(COMPETITION_ROLES).not.toContain(retired);
    }
    expect(SCOUTING_ADMIN_ROLES.every((role) => COMPETITION_ROLES.includes(role))).toBe(true);
  });

  it('gives Scouting Admin to the lead roles only', () => {
    expect(holdsScoutingAdminRole(['Picklist 2 Lead'])).toBe(true);
    expect(holdsScoutingAdminRole([' strategy lead '])).toBe(true);
    expect(holdsScoutingAdminRole(['Strategy Team', 'Driver'])).toBe(false);
    expect(holdsScoutingAdminRole(['Scouting Admin'])).toBe(false);
  });

  it('recognises a Competition Lead by roster key or team role, never when banned', () => {
    expect(isCompetitionLead({ role: 'member' }, ['Competition Lead'])).toBe(true);
    expect(isCompetitionLead({ role: 'member', roster_keys: ['competition lead'] })).toBe(true);
    expect(isCompetitionLead({ role: 'member', team_role: 'Competition Lead' }, [])).toBe(true);
    expect(isCompetitionLead({ role: 'member', banned: true }, ['Competition Lead'])).toBe(false);
    expect(isCompetitionLead({ role: 'member' }, ['Scouting Lead'])).toBe(false);
  });

  it('keeps the scout pool to the three scout roles and Scouting Lead', () => {
    expect(
      ['Data Scout Member', 'Performance Scout Member', 'Robot Scout Member', 'Scouting Lead'].every(isScoutEligibleKey)
    ).toBe(true);
    expect(isScoutEligibleKey('Pit Lead')).toBe(false);
    expect(isScoutEligibleKey('Note Scout Member')).toBe(false);
  });

  it('orders roles and labels scout keys plainly', () => {
    expect(orderCompetitionRoles(['Pit Lead', 'Bogus', 'Competition Lead', 'Pit Lead'])).toEqual([
      'Competition Lead',
      'Pit Lead'
    ]);
    expect(competitionRoleLabel('Performance Scout Member')).toBe('Performance Scout');
    expect(competitionRoleLabel('Pit Lead')).toBe('Pit Lead');
  });
});

describe('hasScoutingAdmin', () => {
  it('is an admin, the Competition Lead, or a lead role that carries Scouting Admin, never a banned person', () => {
    expect(hasScoutingAdmin({ role: 'admin' }, [])).toBe(true);
    expect(hasScoutingAdmin({ role: 'member', team_role: 'Competition Lead' }, [])).toBe(true);
    expect(hasScoutingAdmin({ role: 'member' }, ['Pit Lead'])).toBe(true);
    expect(hasScoutingAdmin({ role: 'member' }, ['Data Scout Member', 'Drive Coach'])).toBe(false);
    expect(hasScoutingAdmin({ role: 'admin', banned: true }, ['Scouting Lead'])).toBe(false);
    expect(hasScoutingAdmin(null, ['Scouting Lead'])).toBe(false);
  });
});

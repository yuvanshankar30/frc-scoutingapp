import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_PAGE,
  SCOUTING_ADMIN_PAGES,
  activeItem,
  allItems,
  BOTTOM_BAR_KEYS,
  bottomBarItems,
  bottomBarKeys,
  canAdministerScouting,
  HOME_ITEM,
  isActive,
  NAV_GROUPS,
  visibleGroups
} from './navigation.js';

describe('navigation', () => {
  it('has unique keys and hrefs, all absolute', () => {
    const items = allItems(true);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    expect(new Set(items.map((item) => item.href)).size).toBe(items.length);
    expect(items.every((item) => item.href.startsWith('/'))).toBe(true);
  });

  it('leaves out the pages Team settings switched off', () => {
    const keys = (hidden) => visibleGroups(true, hidden).flatMap((group) => group.items.map((item) => item.key));
    expect(keys([])).toContain('assistant');
    expect(keys(['assistant', 'predictions'])).not.toContain('assistant');
    expect(keys(['assistant', 'predictions'])).not.toContain('predictions');
    expect(visibleGroups(true, ['pitcrew']).every((group) => group.items.length > 0)).toBe(true);
  });

  it('falls back to Strategy on the phone bar when the role page is switched off', () => {
    expect(bottomBarKeys(['Driver'], ['driveteam']).at(-1)).toBe('strategy');
    expect(bottomBarKeys(['Driver']).at(-1)).toBe('driveteam');
  });

  it('hides the admin group unless the person can administer scouting', () => {
    expect(visibleGroups(false).map((group) => group.key)).not.toContain('admin');
    expect(visibleGroups(true).map((group) => group.key)).toContain('admin');
    expect(allItems(false).map((item) => item.key)).not.toContain('scouting-admin');
    expect(
      allItems(false)
        .map((item) => item.key)
        .some((key) => key.startsWith('scouting-admin'))
    ).toBe(false);
  });

  it('puts every bottom bar destination in the navigation', () => {
    const keys = new Set(allItems(true).map((item) => item.key));
    for (const key of BOTTOM_BAR_KEYS) expect(keys.has(key) || key === HOME_ITEM.key).toBe(true);
  });

  it('matches a path to its own page or a nested one, never a lookalike prefix', () => {
    expect(isActive('/strategy', '/strategy')).toBe(true);
    expect(isActive('/strategy/team/254', '/strategy')).toBe(true);
    expect(isActive('/strategy-old', '/strategy')).toBe(false);
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/anything', '/')).toBe(false);
  });

  it('finds the active item for a nested route', () => {
    expect(activeItem('/scouting-admin/team')?.key).toBe('scouting-admin-team');
    expect(activeItem('/predictions/leaderboard')?.key).toBe('predictions');
    expect(activeItem('/nowhere')).toBeNull();
  });

  it('groups items under a label', () => {
    expect(NAV_GROUPS.every((group) => group.label && group.items.length > 0)).toBe(true);
  });

  it('shows the Scouting Admin tab to admins, Competition Leads and lead competition roles only', () => {
    expect(canAdministerScouting({ role: 'admin' })).toBe(true);
    expect(canAdministerScouting({ role: 'member', roster_keys: ['Strategy Team', 'Strategy Lead'] })).toBe(true);
    expect(canAdministerScouting({ role: 'member', roster_keys: [' scouting lead '] })).toBe(true);
    expect(canAdministerScouting({ role: 'member', roster_keys: ['Competition Lead'] })).toBe(true);
    expect(canAdministerScouting({ role: 'member', team_role: 'Competition Lead', roster_keys: [] })).toBe(true);
    expect(canAdministerScouting({ role: 'member', roster_keys: ['Scouting Admin', 'Data Scout Member'] })).toBe(false);
    expect(
      canAdministerScouting({
        role: 'member',
        general_role: 'lead',
        permissions: ['VIEW_ADMIN_PANEL'],
        roster_keys: []
      })
    ).toBe(false);
    expect(canAdministerScouting({ role: 'admin', banned: true })).toBe(false);
    expect(canAdministerScouting({ role: 'member', banned: true, roster_keys: ['Scouting Lead'] })).toBe(false);
    expect(canAdministerScouting({ role: 'member' })).toBe(false);
    expect(canAdministerScouting(null)).toBe(false);
  });

  it('names the account page in the top bar even though it is not in the menu', () => {
    expect(activeItem('/account', false)).toEqual(ACCOUNT_PAGE);
    expect(allItems(true).map((item) => item.key)).not.toContain('account');
  });

  it('names the admin category Scouting Admin and lists its pages in order', () => {
    const admin = NAV_GROUPS.find((group) => group.key === 'admin');
    expect(admin.label).toBe('Scouting Admin');
    expect(admin.items).toBe(SCOUTING_ADMIN_PAGES);
    expect(SCOUTING_ADMIN_PAGES.map((item) => item.label)).toEqual([
      'Overview',
      'Event setup',
      'Assignments',
      'Training',
      'Deadlines',
      'Edit',
      'People',
      'Team settings',
      'Add user',
      'Data',
      'Extra'
    ]);
  });

  it('highlights the specific admin page, not the overview, on a sub page', () => {
    expect(activeItem('/scouting-admin', true).key).toBe('scouting-admin');
    expect(activeItem('/scouting-admin/event', true).key).toBe('scouting-admin-event');
    expect(activeItem('/scouting-admin/assignments', true).label).toBe('Assignments');
  });
});

describe('phone bottom bar', () => {
  it('is Home, Scout, My Reports and Strategy by default', () => {
    expect(bottomBarKeys([])).toEqual(['home', 'matchscout', 'myscout', 'strategy']);
    expect(bottomBarItems([]).map((item) => item.href)).toEqual(['/', '/matchscout', '/myscout', '/strategy']);
  });

  it('gives the last slot to the page a role uses most', () => {
    expect(bottomBarKeys(['Driver'])).toEqual(['home', 'matchscout', 'myscout', 'driveteam']);
    expect(bottomBarKeys(['Mechanical Pit'])).toEqual(['home', 'matchscout', 'myscout', 'pitcrew']);
    expect(bottomBarKeys(['Mechanical Pit', 'Data Scout Member'])).toEqual([
      'home',
      'matchscout',
      'myscout',
      'strategy'
    ]);
    expect(bottomBarKeys(['data scout member', 'DRIVE COACH'])).toEqual(['home', 'matchscout', 'myscout', 'driveteam']);
  });

  it('resolves every key to a real page', () => {
    for (const roles of [[], ['Driver'], ['Pit Lead']]) expect(bottomBarItems(roles)).toHaveLength(4);
  });
});

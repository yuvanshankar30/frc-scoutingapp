// The app's navigation: grouped by what someone is doing at an event. The layout renders this as a side rail on
// desktop and a bottom bar plus a menu sheet on phones.
import { holdsScoutingAdminRole, isCompetitionLead } from '$lib/scouting/competitionRoles.js';

/** The Scouting Admin pages, grouped by what an admin is doing. Also the tabs across the top of each one. */
export const SCOUTING_ADMIN_PAGES = [
  {
    key: 'scouting-admin',
    label: 'Overview',
    href: '/scouting-admin',
    icon: 'LayoutDashboard',
    blurb: 'Progress and missed matches'
  },
  {
    key: 'scouting-admin-event',
    label: 'Event setup',
    href: '/scouting-admin/event',
    icon: 'CalendarDays',
    blurb: 'Event, teams, sheet and photos'
  },
  {
    key: 'scouting-admin-assignments',
    label: 'Assignments',
    href: '/scouting-admin/assignments',
    icon: 'ListTodo',
    blurb: 'Who scouts what'
  },
  {
    key: 'scouting-admin-edit',
    label: 'Edit',
    href: '/scouting-admin/edit',
    icon: 'Pencil',
    blurb: 'Edit the match and pit scouting forms'
  },
  {
    key: 'scouting-admin-scouts',
    label: 'People',
    href: '/scouting-admin/scouts',
    icon: 'UserCog',
    blurb: 'Names, roles and teams'
  },
  {
    key: 'scouting-admin-team',
    label: 'Team settings',
    href: '/scouting-admin/team',
    icon: 'Settings2',
    blurb: 'Team, colors, logo and pages'
  },
  {
    key: 'scouting-admin-data',
    label: 'Data',
    href: '/scouting-admin/data',
    icon: 'Database',
    blurb: 'Export and reset'
  }
];

export const NAV_GROUPS = [
  {
    key: 'scout',
    label: 'Scout',
    items: [
      {
        key: 'matchscout',
        label: 'Match Scouting',
        href: '/matchscout',
        icon: 'ClipboardCheck',
        blurb: 'Report a robot in a match'
      },
      {
        key: 'pitscout',
        label: 'Pit Scouting',
        href: '/pitscout',
        icon: 'Wrench',
        blurb: 'Profile a robot in the pits'
      },
      { key: 'myscout', label: 'My Reports', href: '/myscout', icon: 'ListChecks', blurb: 'Everything you submitted' }
    ]
  },
  {
    key: 'analyze',
    label: 'Analyze',
    items: [
      {
        key: 'teamview',
        label: 'Team View',
        href: '/teamview',
        icon: 'Search',
        blurb: 'Every team at the event, with charts'
      },
      { key: 'strategy', label: 'Strategy Board', href: '/strategy', icon: 'Target', blurb: 'Every team, one board' },
      {
        key: 'matchview',
        label: 'Match View',
        href: '/matchview',
        icon: 'Swords',
        blurb: 'Both alliances and every report'
      },
      {
        key: 'powerrankings',
        label: 'Power Rankings',
        href: '/powerrankings',
        icon: 'Trophy',
        blurb: 'Robot comparisons and star plots'
      },
      {
        key: 'matchrankings',
        label: 'Match Rankings',
        href: '/matchrankings',
        icon: 'ArrowUpDown',
        blurb: 'Rank the robots in a match'
      },
      { key: 'epa', label: 'EPA', href: '/epa', icon: 'Radar', blurb: 'Expected points added' },
      // Needs GEMINI_API_KEY or OPENAI_API_KEY on the server; shown when Team settings turn it on.
      {
        key: 'assistant',
        label: 'AI analytics',
        href: '/assistant',
        icon: 'Sparkles',
        blurb: 'Ask questions about our scouting data'
      }
    ]
  },
  {
    key: 'field',
    label: 'On the field',
    items: [
      { key: 'driveteam', label: 'Drive Team', href: '/driveteam', icon: 'Gamepad2', blurb: 'Our matches, up next' },
      {
        key: 'picklist',
        label: 'Picklist',
        href: '/picklist',
        icon: 'ClipboardList',
        blurb: 'Shared alliance selection list'
      },
      {
        key: 'bluealliance',
        label: 'Blue Alliance',
        href: '/bluealliance',
        icon: 'Globe',
        blurb: 'Official event data'
      }
    ]
  },
  {
    key: 'admin',
    label: 'Scouting Admin',
    adminOnly: true,
    items: SCOUTING_ADMIN_PAGES
  }
];

/** Home is not in a nav group (the rail and menu show it on its own), but the phone bar needs it as an item. */
export const HOME_ITEM = Object.freeze({
  key: 'home',
  label: 'Home',
  href: '/',
  icon: 'House',
  blurb: 'Next match, standing and your assignments'
});

/** The default four destinations on the phone bottom bar; everything else is under "More". */
export const BOTTOM_BAR_KEYS = ['home', 'matchscout', 'myscout', 'strategy'];

const DRIVE_ROLES = [
  'driver',
  'manipulator',
  'human player',
  'technician',
  'drive coach',
  'drive team',
  'drive team mentor'
];

/**
 * The phone bar for this person: Home, Scout, My Reports, then the page their competition role
 * uses most - Drive Team for the drive team, Pit Crew for the pit, Strategy for everyone else.
 * A scout who is also on the drive team keeps Strategy's slot for Drive Team.
 */
export function bottomBarKeys(rosterKeys = [], hiddenFeatures = []) {
  const keys = new Set(
    (rosterKeys || []).map((key) =>
      String(key || '')
        .trim()
        .toLowerCase()
    )
  );
  const has = (roles) => roles.some((role) => keys.has(role));
  const hidden = new Set(hiddenFeatures || []);
  const preferred = has(DRIVE_ROLES) ? 'driveteam' : 'strategy';
  const last = hidden.has(preferred) ? 'strategy' : preferred;
  return ['home', 'matchscout', 'myscout', last];
}

/** Short labels that fit under a bottom-bar icon. */
export const BOTTOM_BAR_LABELS = Object.freeze({
  home: 'Home',
  matchscout: 'Scout',
  myscout: 'My Reports',
  strategy: 'Strategy',
  driveteam: 'Drive'
});

/** Nav items for the bottom bar, in order. */
export function bottomBarItems(rosterKeys = [], hiddenFeatures = []) {
  const items = [HOME_ITEM, ...allItems(true)];
  return bottomBarKeys(rosterKeys, hiddenFeatures)
    .map((key) => items.find((item) => item.key === key))
    .filter(Boolean);
}

/** The menu for this person. hiddenFeatures are the pages Team settings switched off. */
export function visibleGroups(canAdmin, hiddenFeatures = []) {
  const hidden = new Set(hiddenFeatures || []);
  return NAV_GROUPS.filter((group) => !group.adminOnly || canAdmin)
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.hidden && !hidden.has(item.key)) }))
    .filter((group) => group.items.length);
}

export function allItems(canAdmin = true) {
  return visibleGroups(canAdmin).flatMap((group) => group.items);
}

/** True when pathname is the item's own page or one nested under it. */
export function isActive(pathname, href) {
  if (!href) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The most specific nav item for a path, so /scouting-admin/team wins over /scouting-admin. */
export function activeItem(pathname, canAdmin = true) {
  return (
    [...allItems(canAdmin), ACCOUNT_PAGE]
      .filter((item) => isActive(pathname, item.href))
      .sort((first, second) => second.href.length - first.href.length)[0] || null
  );
}

/**
 * Who sees the Scouting Admin tab: the same rule the server enforces, an admin, a
 * Competition Lead, or anyone holding a competition role that carries Scouting Admin.
 * Showing it to anyone else would lead to a page that refuses them.
 */
export function canAdministerScouting(profile) {
  if (!profile || profile.banned) return false;
  if (profile.role === 'admin') return true;
  if (Array.isArray(profile.permissions) && profile.permissions.includes('VIEW_ADMIN_PANEL')) return true;
  return isCompetitionLead(profile) || holdsScoutingAdminRole(profile.roster_keys);
}

/** Reached from the account icon rather than the menu, but it still names the page in the top bar. */
export const ACCOUNT_PAGE = { key: 'account', label: 'Account', href: '/account' };

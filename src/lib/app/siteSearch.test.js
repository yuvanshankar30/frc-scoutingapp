import { describe, expect, it } from 'vitest';
import { searchSite } from './siteSearch.js';

const pages = [
  { key: 'matchscout', label: 'Match Scouting', href: '/matchscout', blurb: 'Scout one robot', group: 'Scout' },
  {
    key: 'picklist',
    label: 'Picklist',
    href: '/picklist',
    blurb: 'Shared alliance selection list',
    group: 'On the field'
  },
  { key: 'teamview', label: 'Team View', href: '/teamview', blurb: 'Every team at the event', group: 'Analyze' }
];
const teams = [
  { team_number: 254, nickname: 'The Cheesy Poofs', city: 'San Jose', state_prov: 'CA' },
  { team_number: 5940, nickname: 'BREAD', city: 'Palo Alto', state_prov: 'CA' }
];

describe('searchSite', () => {
  it('lists the pages when nothing is typed', () => {
    expect(searchSite('', { pages, teams }).map((result) => result.href)).toEqual([
      '/matchscout',
      '/picklist',
      '/teamview'
    ]);
  });

  it('finds pages by name, word start and description', () => {
    expect(searchSite('pick', { pages })[0].href).toBe('/picklist');
    expect(searchSite('view', { pages })[0].href).toBe('/teamview');
    expect(searchSite('alliance', { pages })[0].href).toBe('/picklist');
  });

  it('finds event teams by number and name and opens them in Team View', () => {
    expect(searchSite('254', { pages, teams })[0]).toMatchObject({ kind: 'Team', href: '/teamview?team=frc254' });
    expect(searchSite('cheesy', { pages, teams })[0].label).toBe('254 · The Cheesy Poofs');
  });

  it('offers any typed team number, even one not at the event', () => {
    expect(searchSite('frc1678', { pages, teams })).toEqual([
      expect.objectContaining({ kind: 'Team', label: '1678', href: '/teamview?team=frc1678' })
    ]);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchSite('zzzz', { pages, teams })).toEqual([]);
  });
});

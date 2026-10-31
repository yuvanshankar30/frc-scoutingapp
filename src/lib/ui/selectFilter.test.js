import { describe, it, expect } from 'vitest';
import { filterSelectOptions, SEARCH_AFTER } from './selectFilter.js';

const options = [
  { value: 'a', label: '#254 The Cheesy Poofs' },
  { value: 'b', label: '#5940 Gearheads Robotics' },
  { value: 'c', label: '#9496 LYNK' },
  { value: 'd', label: 'Robotics Club' }
];

describe('filterSelectOptions', () => {
  it('keeps everything for an empty search', () => {
    expect(filterSelectOptions(options, '')).toEqual(options);
  });
  it('needs every word, in any order, ignoring case and #', () => {
    expect(filterSelectOptions(options, 'robotics gearheads').map((o) => o.value)).toEqual(['b']);
    expect(filterSelectOptions(options, '#5940').map((o) => o.value)).toEqual(['b']);
  });
  it('lists options that start with the search first', () => {
    expect(filterSelectOptions(options, 'robotics').map((o) => o.value)).toEqual(['d', 'b']);
  });
  it('lists the whole phrase before words that only match separately', () => {
    const teams = [
      { value: 'x', label: '#902 Team 0' },
      { value: 'y', label: '#900 Team 2' }
    ];
    expect(filterSelectOptions(teams, 'team 2').map((o) => o.value)).toEqual(['y', 'x']);
  });
  it('searches only the longer lists', () => {
    expect(SEARCH_AFTER).toBe(8);
  });
});

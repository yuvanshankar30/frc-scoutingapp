import { describe, it, expect } from 'vitest';
import { filterTeamOptions } from './teamPicker.js';

const options = [
  { value: 'frc254', number: 254, name: 'The Cheesy Poofs' },
  { value: 'frc5940', number: 5940, name: 'Gearheads' },
  { value: 'frc1540', number: 1540, name: 'Flaming Chickens' },
  { value: 'frc9496', number: 9496, name: 'LYNK' },
  { value: 'frc4414', number: 4414, name: 'HighTide' }
];

describe('filterTeamOptions', () => {
  it('returns everything for an empty search', () => {
    expect(filterTeamOptions(options, '')).toHaveLength(5);
    expect(filterTeamOptions(options, '   ')).toHaveLength(5);
  });
  it('matches the start of a number, with or without #', () => {
    expect(filterTeamOptions(options, '59').map((o) => o.number)).toEqual([5940]);
    expect(filterTeamOptions(options, '#25').map((o) => o.number)).toEqual([254]);
  });
  it('matches any part of a name, ignoring case', () => {
    expect(filterTeamOptions(options, 'chick').map((o) => o.number)).toEqual([1540]);
    expect(filterTeamOptions(options, 'LYNK').map((o) => o.number)).toEqual([9496]);
  });
  it('needs every word to match', () => {
    expect(filterTeamOptions(options, 'gearheads 5940')).toHaveLength(1);
    expect(filterTeamOptions(options, 'gearheads 254')).toHaveLength(0);
  });
});

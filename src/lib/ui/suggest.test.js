import { describe, it, expect } from 'vitest';
import { suggestionsFor } from './suggest.js';

const options = [
  { value: '5940', text: 'Gearheads' },
  { value: 'frc5940', text: '' },
  { value: '254', text: 'The Cheesy Poofs' },
  { value: '5940', text: 'duplicate' }
];

describe('suggestionsFor', () => {
  it('lists everything, once each, for an empty box', () => {
    expect(suggestionsFor(options, '').map((o) => o.value)).toEqual(['5940', 'frc5940', '254']);
  });
  it('matches the value or the note, starting-with first', () => {
    expect(suggestionsFor(options, '59').map((o) => o.value)).toEqual(['5940', 'frc5940']);
    expect(suggestionsFor(options, 'cheesy').map((o) => o.value)).toEqual(['254']);
  });
  it('stays quiet once the box already holds the only match', () => {
    expect(suggestionsFor([{ value: '254', text: '' }], '254')).toEqual([]);
  });
});

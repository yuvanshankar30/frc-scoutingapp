import { describe, expect, it } from 'vitest';
import {
  compareMatchKeys,
  compareTbaMatches,
  matchKeyOrder,
  matchLabel,
  shortMatchLabel,
  tbaMatchLabel,
  tbaMatchSuffix
} from './matchKeys.js';

describe('match order', () => {
  it('orders match keys the way they are played, with unreadable keys last', () => {
    const keys = ['2026cc_f1m1', 'junk', '2026cc_qm10', '2026cc_sf2m1', '2026cc_qm2', '2026cc_sf1m3'];
    expect([...keys].sort(compareMatchKeys)).toEqual([
      '2026cc_qm2',
      '2026cc_qm10',
      '2026cc_sf1m3',
      '2026cc_sf2m1',
      '2026cc_f1m1',
      'junk'
    ]);
    expect(matchKeyOrder('Quals 12')).toEqual([1, 12, 0]);
    // Practice matches come first, in number order, like compareTbaMatches.
    expect(['2026x_qm1', '2026x_pm10', '2026x_pm3'].sort(compareMatchKeys)).toEqual([
      '2026x_pm3',
      '2026x_pm10',
      '2026x_qm1'
    ]);
  });

  it('orders TBA match objects by level, set and match number', () => {
    const matches = [
      { comp_level: 'f', set_number: 1, match_number: 1 },
      { comp_level: 'qm', set_number: 1, match_number: 10 },
      { comp_level: 'sf', set_number: 1, match_number: 1 },
      { comp_level: 'qm', set_number: 1, match_number: 2 },
      { comp_level: 'pm', set_number: 1, match_number: 1 }
    ];
    expect([...matches].sort(compareTbaMatches).map((m) => `${m.comp_level}${m.match_number}`)).toEqual([
      'pm1',
      'qm2',
      'qm10',
      'sf1',
      'f1'
    ]);
  });
});

describe('match labels', () => {
  it('reads qualification, playoff, final and practice keys', () => {
    expect(matchLabel('2026cabl_qm12')).toBe('Qual 12');
    expect(matchLabel('2026cabl_sf2m1')).toBe('Semifinal 2 · Match 1');
    expect(matchLabel('2026cabl_f1m2')).toBe('Final 2');
    expect(matchLabel('2026cabl_pm4')).toBe('Practice 4');
    expect(matchLabel('scout typed this')).toBe('scout typed this');
  });

  it('labels TBA match objects the same way', () => {
    expect(tbaMatchSuffix({ comp_level: 'sf', set_number: 2, match_number: 1 })).toBe('sf2m1');
    expect(tbaMatchLabel({ comp_level: 'qm', match_number: 12 })).toBe('Qual 12');
    expect(tbaMatchLabel({ comp_level: 'sf', set_number: 2, match_number: 1 })).toBe('Semifinal 2 · Match 1');
    expect(tbaMatchLabel({ comp_level: 'f', set_number: 1, match_number: 3 })).toBe('Final 3');
    expect(tbaMatchLabel({ comp_level: 'test', match_number: 3 })).toBe('Test match 3');
    expect(tbaMatchLabel(null)).toBe('Match');
  });

  it('shortens keys for chart axes', () => {
    expect(shortMatchLabel('2026cabl_qm12')).toBe('Q12');
    expect(shortMatchLabel('2026cabl_sf2m1')).toBe('SF2-1');
    expect(shortMatchLabel('2026cabl_pm4')).toBe('PM4');
  });
});

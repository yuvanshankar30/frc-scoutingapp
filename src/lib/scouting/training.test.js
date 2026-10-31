import { describe, expect, it } from 'vitest';
import {
  autoFillSlots,
  matchKeyFor,
  nextTrainingMatchKey,
  pickRandom,
  searchPastEvents,
  simplifyTbaMatch,
  sortTbaMatches
} from './training.js';

describe('training match keys', () => {
  it('uses the lowest unused qualification number under the training code', () => {
    expect(nextTrainingMatchKey('2026training', [])).toBe('2026training_qm1');
    expect(nextTrainingMatchKey('2026training', ['2026training_qm1', '2026training_qm3'])).toBe('2026training_qm2');
  });

  it('reads the match a scout typed or a link carried', () => {
    expect(matchKeyFor('2026training', '3')).toBe('2026training_qm3');
    expect(matchKeyFor('2026training', 'Qual 4')).toBe('2026training_qm4');
    expect(matchKeyFor('2026training', 'sf2m1')).toBe('2026training_sf2m1');
    expect(matchKeyFor('2026training', '2026training_qm9')).toBe('2026training_qm9');
    expect(matchKeyFor('', '3')).toBe('');
  });
});

describe('TBA matches', () => {
  const tba = {
    key: '2025casj_sf2m1',
    comp_level: 'sf',
    set_number: 2,
    match_number: 1,
    alliances: {
      red: { team_keys: ['frc1', 'frc2', 'frc3'], score: 120 },
      blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: 98 }
    },
    videos: [
      { type: 'tba', key: 'x' },
      { type: 'youtube', key: 'abc' }
    ]
  };
  it('labels and trims a match, keeping the YouTube video', () => {
    expect(simplifyTbaMatch(tba)).toMatchObject({
      label: 'Semifinal 2 · Match 1',
      red: ['frc1', 'frc2', 'frc3'],
      blue_score: 98,
      video_key: 'abc'
    });
  });
  it('sorts qualifications before playoffs', () => {
    const sorted = sortTbaMatches([
      { comp_level: 'f', set_number: 1, match_number: 1 },
      { comp_level: 'qm', set_number: 1, match_number: 10 },
      { comp_level: 'qm', set_number: 1, match_number: 2 }
    ]);
    expect(sorted.map((match) => `${match.comp_level}${match.match_number}`)).toEqual(['qm2', 'qm10', 'f1']);
  });
});

describe('searchPastEvents', () => {
  const events = [
    { key: '2025casj', name: 'Silicon Valley Regional', city: 'San Jose', end_date: '2025-03-30', week: 4 },
    { key: '2025cadm', name: 'Sacramento Regional', city: 'Davis', end_date: '2025-03-16', week: 2 },
    { key: '2026future', name: 'Future Event', end_date: '2099-01-01' }
  ];
  it('lists finished events newest first and matches every search word', () => {
    expect(searchPastEvents(events, '', '2026-10-13').map((event) => event.key)).toEqual(['2025casj', '2025cadm']);
    expect(searchPastEvents(events, 'san jose', '2026-10-13').map((event) => event.key)).toEqual(['2025casj']);
    expect(searchPastEvents(events, 'week 3', '2026-10-13').map((event) => event.key)).toEqual(['2025cadm']);
  });
});

describe('autoFillSlots', () => {
  it('fills empty slots evenly, keeps existing scouts and never puts one scout on two robots in a match', () => {
    const slots = [
      { match_key: 'm1', team_key: 'frc1', user_id: 'a' },
      { match_key: 'm1', team_key: 'frc2', user_id: null },
      { match_key: 'm1', team_key: 'frc3', user_id: null },
      { match_key: 'm2', team_key: 'frc4', user_id: null }
    ];
    expect(autoFillSlots(slots, ['a', 'b'])).toEqual([
      { match_key: 'm1', team_key: 'frc2', user_id: 'b' },
      { match_key: 'm2', team_key: 'frc4', user_id: 'a' }
    ]);
    expect(autoFillSlots(slots, [])).toEqual([]);
  });

  it('picks randomly with an injectable source', () => {
    expect(pickRandom([1, 2, 3], () => 0.99)).toBe(3);
    expect(pickRandom([], () => 0)).toBeNull();
  });
});

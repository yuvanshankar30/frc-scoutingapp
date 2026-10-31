import { describe, expect, it } from 'vitest';
import {
  normalizeTbaEventKey,
  pickSuggestedKeys,
  rankEventsByText,
  relabelTbaPayload,
  searchYear,
  swapEventPrefix
} from './tbaEventLink.js';

describe('event key swapping', () => {
  it('moves match and event keys between the code and the tracked event only', () => {
    expect(swapEventPrefix('2026practice_qm3', '2026practice', '2026mttd')).toBe('2026mttd_qm3');
    expect(swapEventPrefix('2026practice', '2026practice', '2026mttd')).toBe('2026mttd');
    expect(swapEventPrefix('2026practicex_qm3', '2026practice', '2026mttd')).toBe('2026practicex_qm3');
    expect(swapEventPrefix('frc5940', '2026practice', '2026mttd')).toBe('frc5940');
    expect(swapEventPrefix('2026mttd_qm1', '2026mttd', '2026mttd')).toBe('2026mttd_qm1');
  });

  it('renames a TBA answer back to the code, leaving teams and numbers alone', () => {
    const answer = [
      {
        key: '2026mttd_qm1',
        event_key: '2026mttd',
        alliances: { red: { team_keys: ['frc5940'], score: 40 } },
        match_number: 1
      }
    ];
    expect(relabelTbaPayload(answer, '2026mttd', '2026practice')).toEqual([
      {
        key: '2026practice_qm1',
        event_key: '2026practice',
        alliances: { red: { team_keys: ['frc5940'], score: 40 } },
        match_number: 1
      }
    ]);
    expect(relabelTbaPayload(answer, '2026mttd', '2026mttd')).toBe(answer);
  });

  it('accepts only real-looking event keys', () => {
    expect(normalizeTbaEventKey(' 2026MTTD ')).toBe('2026mttd');
    for (const bad of ['', 'mttd', '2026', '2026mttd_qm1', '2026 mttd', null])
      expect(normalizeTbaEventKey(bad)).toBeNull();
  });
});

describe('event search helpers', () => {
  const events = [
    { key: '2026mttd', name: 'MadTown Throwdown', city: 'Madera', start_date: '2026-10-17' },
    { key: '2026cc', name: 'Chezy Champs', city: 'San Jose', start_date: '2026-09-26' },
    { key: '2026casj', name: 'Silicon Valley Regional', city: 'San Jose', start_date: '2026-03-26' }
  ];
  it('ranks events by name, city and code words', () => {
    expect(rankEventsByText(events, 'madtown').map((event) => event.key)).toEqual(['2026mttd']);
    expect(rankEventsByText(events, 'san jose').map((event) => event.key)).toEqual(['2026casj', '2026cc']);
    expect(rankEventsByText(events, 'mttd').map((event) => event.key)).toEqual(['2026mttd']);
    expect(rankEventsByText(events, '2026')).toEqual([]);
  });

  it('picks the season from the query, then the code', () => {
    expect(searchYear('chezy 2025', '2026cc', new Date('2026-10-13'))).toBe(2025);
    expect(searchYear('chezy', '2024x', new Date('2026-10-13'))).toBe(2024);
    expect(searchYear('chezy', '', new Date('2026-10-13'))).toBe(2026);
  });

  it('keeps only candidate keys from the model, in order', () => {
    expect(
      pickSuggestedKeys('Sure: {"matches":[{"key":"2026cc"},{"key":"2099fake"},{"key":"2026mttd"},{"key":"2026cc"}]}', [
        '2026cc',
        '2026mttd'
      ])
    ).toEqual(['2026cc', '2026mttd']);
    expect(pickSuggestedKeys('["2026mttd"]', ['2026mttd'])).toEqual(['2026mttd']);
    expect(pickSuggestedKeys('no json here', ['2026mttd'])).toEqual([]);
  });

  it('skips DB queries and cache storage for malformed event keys (SEC-08)', async () => {
    const { tbaEventKeyFor } = await import('$lib/server/scouting/tbaEventLink.js');
    let queried = false;
    const fakeDb = {
      from: () => {
        queried = true;
        throw new Error('should not query');
      }
    };
    expect(await tbaEventKeyFor('not-an-event-key!', fakeDb)).toBe('not-an-event-key!');
    expect(queried).toBe(false);
  });
});

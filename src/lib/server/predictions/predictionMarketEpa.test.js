import { describe, expect, it } from 'vitest';
import { eventModel, fetchEpaScoutEntries } from './predictionMarketV2.js';

// A fake Supabase query builder that serves `rows` in pages.
function fakeDb(rows, { error = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range(from, to) {
          calls.push({ table, from, to });
          return Promise.resolve(error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null });
        }
      };
      return query;
    }
  };
}

describe('fetchEpaScoutEntries', () => {
  it('reads every page of match scouting for the event', async () => {
    const rows = Array.from({ length: 1500 }, (unused, index) => ({ match_key: `m${index}`, team_key: 'frc1' }));
    const db = fakeDb(rows);
    expect(await fetchEpaScoutEntries(db, '2026cc')).toHaveLength(1500);
    expect(db.calls.map((call) => call.table)).toEqual(['match_scout_entries', 'match_scout_entries']);
  });

  it('returns no scouting, never an error, when the read fails or there is no database', async () => {
    expect(await fetchEpaScoutEntries(fakeDb([], { error: { message: 'relation does not exist' } }), '2026cc')).toEqual(
      []
    );
    expect(await fetchEpaScoutEntries(null, '2026cc')).toEqual([]);
  });
});

describe('eventModel', () => {
  it('gives a probability per match, favouring the alliance that has been outscoring', () => {
    const played = (number, redScore, blueScore) => ({
      key: `2026tst_qm${number}`,
      comp_level: 'qm',
      match_number: number,
      actual_time: 1000 + number,
      alliances: {
        red: { team_keys: ['frc1', 'frc2', 'frc3'], score: redScore },
        blue: { team_keys: ['frc4', 'frc5', 'frc6'], score: blueScore }
      }
    });
    const upcoming = { ...played(4, -1, -1), actual_time: null };
    const probabilities = eventModel([played(1, 120, 60), played(2, 130, 70), played(3, 110, 50), upcoming], []);
    expect(probabilities.get('2026tst_qm4')).toBeGreaterThan(0.5);
  });
});

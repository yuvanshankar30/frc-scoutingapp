import { describe, expect, it } from 'vitest';
import { fixMatchKey, isCanonicalReportKey, listMatchKeyReview } from './matchKeyReview.js';

function fakeDb(tables, { updateError = null } = {}) {
  const updates = [];
  const from = (table) => {
    const state = { table, filters: [], patch: null };
    const rows = () => (tables[table] || []).filter((row) => state.filters.every(([col, val]) => row[col] === val));
    const api = {
      select: () => api,
      order: () => api,
      not: () => api,
      eq: (col, val) => {
        state.filters.push([col, val]);
        return api;
      },
      update: (patch) => {
        state.patch = patch;
        return api;
      },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => {
        if (updateError) return { data: null, error: updateError };
        updates.push({ table, ...state.patch });
        return { data: { ...rows()[0], ...state.patch }, error: null };
      },
      then: (resolve) => resolve({ data: rows(), error: null })
    };
    return api;
  };
  return { from, updates };
}

describe('match key review', () => {
  it('only lists rows whose key is not a canonical key for their own event', async () => {
    const db = fakeDb({
      match_scout_entries: [
        { id: 1, event_key: '2026cc', match_key: '2026cc_qm12' },
        { id: 2, event_key: '2026cc', match_key: 'einstein match 10' },
        { id: 3, event_key: '2026cc', match_key: '2026cacg_qm3' }
      ],
      pit_problem_reports: [{ id: 9, event_key: '2026cc', match_key: 'Qual 16' }]
    });
    const { data } = await listMatchKeyReview(db);
    expect(data.reports.map((row) => row.id)).toEqual([2, 3]);
    expect(data.problems.map((row) => row.id)).toEqual([9]);
    expect(isCanonicalReportKey({ event_key: '2026cc', match_key: '2026cc_sf2m1' })).toBe(true);
  });

  it('stores the canonical key for what the admin typed', async () => {
    const db = fakeDb({ match_scout_entries: [{ id: 2, event_key: '2026cc', match_key: '35 second try' }] });
    const result = await fixMatchKey(db, { kind: 'report', id: 2, match: '35' });
    expect(result.data.match_key).toBe('2026cc_qm35');
    expect(db.updates).toEqual([{ table: 'match_scout_entries', match_key: '2026cc_qm35' }]); // no submitter on this row, so no scout to link
  });

  it('refuses unreadable input and explains a duplicate', async () => {
    const db = fakeDb({ match_scout_entries: [{ id: 2, event_key: '2026cc', match_key: 'x' }] });
    expect((await fixMatchKey(db, { kind: 'report', id: 2, match: 'galileo' })).status).toBe(400);
    expect((await fixMatchKey(db, { kind: 'nope', id: 2, match: '1' })).status).toBe(400);
    const dup = fakeDb(
      { match_scout_entries: [{ id: 2, event_key: '2026cc', match_key: 'x' }] },
      { updateError: { code: '23505', message: 'dup' } }
    );
    expect(await fixMatchKey(dup, { kind: 'report', id: 2, match: '12' })).toMatchObject({ status: 409 });
  });
});

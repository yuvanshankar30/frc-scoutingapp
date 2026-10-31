import { describe, expect, it } from 'vitest';
import { clearAllScoutingDrafts, clearScoutingDraft, loadScoutingDraft, saveScoutingDraft } from './draftStore.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

describe('draftStore (COMP-13 / COMP-06)', () => {
  it('saves, loads, and clears an in-progress scouting form draft', () => {
    const s = fakeStorage();
    expect(saveScoutingDraft('match', '2026caav:qm1:frc5940', { autoMoved: 'ran', notes: 'fast cycle' }, s)).toBe(true);
    expect(loadScoutingDraft('match', '2026caav:qm1:frc5940', s)).toEqual({ autoMoved: 'ran', notes: 'fast cycle' });
    expect(clearScoutingDraft('match', '2026caav:qm1:frc5940', s)).toBe(true);
    expect(loadScoutingDraft('match', '2026caav:qm1:frc5940', s)).toBeNull();
  });

  it('clears all scouting drafts across match and pit forms on clearAllScoutingDrafts', () => {
    const s = fakeStorage();
    saveScoutingDraft('match', '2026caav:qm1:frc5940', { notes: 'a' }, s);
    saveScoutingDraft('pit', '2026caav:frc254', { drivebase: 'Swerve' }, s);
    clearAllScoutingDrafts(s);
    expect(loadScoutingDraft('match', '2026caav:qm1:frc5940', s)).toBeNull();
    expect(loadScoutingDraft('pit', '2026caav:frc254', s)).toBeNull();
  });
});

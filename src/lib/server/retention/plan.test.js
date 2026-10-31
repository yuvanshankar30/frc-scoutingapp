import { describe, expect, it } from 'vitest';
import { buildCleanupPlan, eventSeason, summarizeSizes } from './plan.js';
import { RETENTION_POLICY, retentionLimits } from './policy.js';

const MB = 1024 * 1024;
const now = new Date('2027-06-01T00:00:00Z');
const sizes = (dbMb, bucketMb = 10) => [
  { kind: 'database', name: 'postgres', bytes: dbMb * MB, objects: null },
  { kind: 'table', name: 'activity_log', bytes: 70 * MB, objects: 16000 },
  { kind: 'table', name: 'scout_data_events', bytes: 2 * MB, objects: 8000 },
  { kind: 'bucket', name: 'branding', bytes: bucketMb * MB, objects: 1000 },
  { kind: 'bucket', name: 'pit-scout-photos', bytes: 24 * MB, objects: 46 }
];
const inventory = [
  { source: 'scout_data_events', event_key: '2026cahal', items: 8139, newest: '2026-03-08T19:10:11Z' },
  { source: 'scout_data_events', event_key: '2027casj', items: 400, newest: '2027-03-08T19:10:11Z' },
  { source: 'scout_data_events', event_key: '2026hop', items: 3, newest: '2027-05-25T00:00:00Z' },
  { source: 'storage:pit-scout-photos', event_key: '2026cc', items: 46, newest: '2026-10-18T05:18:23Z' },
  { source: 'storage:pit-scout-photos', event_key: '', items: 9, newest: null }
];
const limits = { dbBytes: 400 * MB, storageBytes: 800 * MB };

describe('retention plan', () => {
  it('reads the season from an event key and nothing else', () => {
    expect(eventSeason('2026cc')).toBe(2026);
    expect(eventSeason('2026CAHAL')).toBe(2026);
    expect(eventSeason('')).toBeNull();
    expect(eventSeason('testing')).toBeNull();
    expect(eventSeason('2026_cc')).toBeNull();
  });

  it('sums storage over every bucket and labels what the policy may clean', () => {
    const totals = summarizeSizes(sizes(170));
    expect(totals.dbBytes).toBe(170 * MB);
    expect(totals.storageBytes).toBe(34 * MB);
    expect(totals.tables.map((t) => [t.name, t.cleanable])).toEqual([
      ['activity_log', false],
      ['scout_data_events', true]
    ]);
    expect(totals.buckets.find((b) => b.name === 'branding').cleanable).toBe(false);
  });

  it('plans nothing while every limit is under, but still lists what would qualify', () => {
    const plan = buildCleanupPlan({ sizes: sizes(170), inventory, limits, activeEventKey: '2027casj', now });
    expect(plan.triggered).toBe(false);
    expect(plan.items).toEqual([]);
    expect(plan.planId).toBeNull();
    expect(plan.eligible.length).toBeGreaterThan(0);
  });

  it('only offers past-season events whose newest item is older than keepDays, never the active event', () => {
    const plan = buildCleanupPlan({ sizes: sizes(450), inventory, limits, activeEventKey: '2027casj', now });
    expect(plan.triggered).toBe(true);
    expect(plan.reasons).toEqual(['database']);
    expect(plan.items.map((i) => [i.policyId, i.eventKey, i.count])).toEqual([
      ['pit_photos', '2026cc', 46],
      ['scout_data_events', '2026cahal', 8139]
    ]);
    // 2027casj is this season (and active); 2026hop's newest log is a week old; blank event keys never qualify.
    expect(plan.items.some((i) => i.eventKey === '2027casj' || i.eventKey === '2026hop' || i.eventKey === '')).toBe(
      false
    );
  });

  it('never cleans the current season, judged by the active event (or the year when none is set)', () => {
    const during2026 = buildCleanupPlan({
      sizes: sizes(450),
      inventory,
      limits,
      activeEventKey: '2026testing',
      now
    });
    expect(during2026.season).toBe(2026);
    expect(during2026.items).toEqual([]);
    const noEvent = buildCleanupPlan({ sizes: sizes(450), inventory, limits, activeEventKey: '', now });
    expect(noEvent.season).toBe(2027);
    expect(noEvent.items.length).toBe(2);
  });

  it('adds global sources from their counts and triggers on storage too', () => {
    const plan = buildCleanupPlan({
      sizes: sizes(100, 900),
      inventory: [],
      globalCounts: { notification_logs: 1200 },
      limits,
      now
    });
    expect(plan.reasons).toEqual(['storage']);
    expect(plan.items).toEqual([
      expect.objectContaining({ policyId: 'notification_logs', count: 1200, olderThanDays: 90 })
    ]);
  });

  it('names the exact plan, so a changed plan cannot be approved by an old id', () => {
    const args = { sizes: sizes(450), inventory, limits, activeEventKey: '2027casj', now };
    const a = buildCleanupPlan(args);
    const b = buildCleanupPlan(args);
    const c = buildCleanupPlan({ ...args, inventory: [...inventory.slice(0, 2), { ...inventory[2], items: 21 }] });
    expect(a.planId).toMatch(/^[0-9a-f]{16}$/);
    expect(b.planId).toBe(a.planId);
    expect(c.planId).not.toBe(a.planId);
  });
});

describe('retention policy', () => {
  it('defaults to 80% of the Supabase free plan and reads overrides in MB', () => {
    expect(retentionLimits({})).toEqual({ dbBytes: 400 * MB, storageBytes: 800 * MB });
    expect(retentionLimits({ RETENTION_DB_LIMIT_MB: '6400', RETENTION_STORAGE_LIMIT_MB: 'x' })).toEqual({
      dbBytes: 6400 * MB,
      storageBytes: 800 * MB
    });
  });

  it('never lists scouting reports, picklists, activity_log or the branding bucket', () => {
    const sources = RETENTION_POLICY.map((p) => p.source).join(' ');
    for (const kept of [
      'match_scout_entries',
      'pit_scout_entries',
      'scouting_picklist',
      'activity_log',
      'manufacturing-files'
    ])
      expect(sources).not.toContain(kept);
    expect(Object.isFrozen(RETENTION_POLICY)).toBe(true);
  });
});

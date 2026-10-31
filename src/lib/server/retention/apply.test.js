import { describe, expect, it } from 'vitest';
import { applyCleanupPlan, ROW_BATCH } from './apply.js';

// A fake Supabase client: every query is recorded as { table, ops }, and `answer(table, ops)` returns its result.
function fakeDb(answer) {
  const log = [];
  const removed = [];
  const chain = (table) => {
    const ops = [];
    const q = {};
    for (const name of ['select', 'ilike', 'order', 'in', 'is', 'not', 'eq', 'lt', 'delete', 'insert', 'range']) {
      q[name] = (...args) => {
        ops.push([name, ...args]);
        return q;
      };
    }
    q.then = (resolve, reject) => {
      log.push({ table, ops });
      return Promise.resolve(answer(table, ops)).then(resolve, reject);
    };
    return q;
  };
  return {
    log,
    removed,
    from: chain,
    rpc: async (name, args) => {
      log.push({ table: `rpc:${name}`, ops: [args] });
      return answer(`rpc:${name}`, [args]);
    },
    storage: {
      from: (bucket) => ({
        remove: async (names) => {
          removed.push([bucket, names]);
          return { error: null };
        }
      })
    }
  };
}

const has = (ops, name) => ops.some((op) => op[0] === name);

describe('applyCleanupPlan', () => {
  it('deletes scouting event logs of one event in batches and logs one summary row', async () => {
    const ids = Array.from({ length: ROW_BATCH + 5 }, (_, i) => `e${i}`);
    const db = fakeDb((table, ops) => {
      if (table === 'scout_data_events' && has(ops, 'select')) {
        const [, from] = ops.find((op) => op[0] === 'range');
        return { data: ids.slice(from, from + ROW_BATCH).map((id) => ({ id })), error: null };
      }
      return { data: null, error: null };
    });
    const plan = {
      planId: 'abc',
      reasons: ['database'],
      items: [{ policyId: 'scout_data_events', eventKey: '2026cahal', count: ids.length }]
    };
    const result = await applyCleanupPlan(db, plan, { actorId: 'admin-1' });
    expect(result.deleted).toEqual([{ policyId: 'scout_data_events', eventKey: '2026cahal', count: ROW_BATCH + 5 }]);
    const deletes = db.log.filter((q) => q.table === 'scout_data_events' && has(q.ops, 'delete'));
    expect(deletes.map((q) => q.ops.find((op) => op[0] === 'in')[2].length)).toEqual([ROW_BATCH, 5]);
    const select = db.log.find((q) => q.table === 'scout_data_events' && has(q.ops, 'select'));
    expect(select.ops).toContainEqual(['ilike', 'match_key', '2026cahal\\_%']);
    const summary = db.log.find((q) => q.table === 'activity_log');
    expect(summary.ops[0][1]).toMatchObject({
      table_name: 'data_cleanup',
      operation: 'DELETE',
      row_id: 'abc',
      actor: 'admin-1'
    });
  });

  it("removes only the event folder's files from the planned bucket, and reports a failed part", async () => {
    const db = fakeDb((table) => {
      if (table === 'rpc:retention_storage_objects')
        return { data: [{ name: '2026cc/5940/a.jpg' }, { name: '2026cc/../x' }], error: null };
      if (table === 'scout_data_events') return { data: null, error: { message: 'boom' } };
      return { data: null, error: null };
    });
    const result = await applyCleanupPlan(db, {
      planId: 'p',
      items: [
        { policyId: 'pit_photos', eventKey: '2026cc', count: 2, bucket: 'pit-scout-photos' },
        { policyId: 'scout_data_events', eventKey: '2026cc', count: 1 }
      ]
    });
    expect(db.removed).toEqual([['pit-scout-photos', ['2026cc/5940/a.jpg']]]);
    expect(db.log.find((q) => q.table === 'rpc:retention_storage_objects').ops[0]).toEqual({
      p_bucket: 'pit-scout-photos',
      p_event_key: '2026cc'
    });
    expect(result.deleted).toEqual([{ policyId: 'pit_photos', eventKey: '2026cc', count: 1 }]);
    expect(result.errors).toEqual([{ policyId: 'scout_data_events', eventKey: '2026cc', error: 'boom' }]);
  });

  it("deletes only the competition app's notification types, older than the cutoff", async () => {
    const db = fakeDb((table, ops) =>
      table === 'user_notification_logs' && has(ops, 'select')
        ? { data: [{ id: 'n1' }], error: null }
        : { data: null, error: null }
    );
    const now = new Date('2027-06-01T00:00:00Z');
    await applyCleanupPlan(db, { planId: 'p', items: [{ policyId: 'notification_logs', count: 1 }] }, { now });
    const select = db.log.find((q) => q.table === 'user_notification_logs' && has(q.ops, 'select'));
    expect(select.ops).toContainEqual(['in', 'event_type', ['shift_assignments', 'match_reminders', 'data_cleanup']]);
    expect(select.ops).toContainEqual(['lt', 'sent_at', '2027-03-03T00:00:00.000Z']);
  });
});

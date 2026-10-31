// The cleanup plan (#125): which items would be deleted, from sizes, the per-event inventory and the policy. Pure, so
// the admin page, the daily check and the approve action all compute exactly the same plan.
import { createHash } from 'node:crypto';
import { CLEANABLE_BUCKETS, CLEANABLE_TABLES, RETENTION_POLICY } from './policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_KEY_RE = /^(\d{4})[a-z0-9]+$/;

/** The season (year) of an event key such as 2026cc, or null for anything else. */
export function eventSeason(eventKey) {
  const match = EVENT_KEY_RE.exec(String(eventKey || '').toLowerCase());
  return match ? Number(match[1]) : null;
}

/** Totals from retention_sizes() rows: database bytes, storage bytes, and the tables and buckets largest first. */
export function summarizeSizes(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const db = list.find((r) => r?.kind === 'database');
  const tables = list
    .filter((r) => r?.kind === 'table')
    .map((r) => ({ name: r.name, bytes: Number(r.bytes) || 0, rows: Number(r.objects) || 0 }))
    .map((t) => ({ ...t, cleanable: CLEANABLE_TABLES.includes(t.name) }))
    .sort((a, b) => b.bytes - a.bytes);
  const buckets = list
    .filter((r) => r?.kind === 'bucket')
    .map((r) => ({ name: r.name, bytes: Number(r.bytes) || 0, files: Number(r.objects) || 0 }))
    .map((b) => ({ ...b, cleanable: CLEANABLE_BUCKETS.includes(b.name) }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    dbBytes: Number(db?.bytes) || 0,
    storageBytes: buckets.reduce((sum, b) => sum + b.bytes, 0),
    tables,
    buckets
  };
}

function eligibleEventItem(policy, row, { activeEventKey, season, nowMs }) {
  const eventKey = String(row?.event_key || '').toLowerCase();
  const eventYear = eventSeason(eventKey);
  if (!eventYear || eventYear >= season) return null; // current season (and anything undated) is never cleaned
  if (activeEventKey && eventKey === activeEventKey) return null;
  const newestMs = row?.newest ? Date.parse(row.newest) : NaN;
  if (Number.isFinite(newestMs) && nowMs - newestMs < policy.keepDays * DAY_MS) return null;
  const count = Number(row?.items) || 0;
  if (count <= 0) return null;
  return {
    policyId: policy.id,
    label: policy.label,
    unit: policy.unit,
    eventKey,
    count,
    newest: row?.newest || null,
    ...(policy.bucket ? { bucket: policy.bucket } : {})
  };
}

/**
 * Build the plan.
 *   sizes: retention_sizes() rows; inventory: retention_event_inventory() rows;
 *   globalCounts: { [policyId]: rows older than keepDays } for global sources; limits: retentionLimits();
 *   activeEventKey: scouting_settings.event_key; now: Date.
 * `eligible` always lists what the policy allows; `items` is empty unless a limit is crossed. `planId` names the exact
 * items, so an approval deletes what the admin saw and nothing else.
 */
export function buildCleanupPlan({
  sizes = [],
  inventory = [],
  globalCounts = {},
  limits,
  activeEventKey = '',
  now = new Date(),
  policy = RETENTION_POLICY
} = {}) {
  const totals = summarizeSizes(sizes);
  const active = String(activeEventKey || '').toLowerCase();
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const season = eventSeason(active) || new Date(nowMs).getUTCFullYear();

  const eligible = [];
  for (const entry of policy) {
    if (entry.scope === 'event') {
      for (const row of inventory || []) {
        if (row?.source !== entry.source) continue;
        const item = eligibleEventItem(entry, row, { activeEventKey: active, season, nowMs });
        if (item) eligible.push(item);
      }
    } else if (entry.scope === 'global') {
      const count = Number(globalCounts?.[entry.id]) || 0;
      if (count > 0)
        eligible.push({
          policyId: entry.id,
          label: entry.label,
          unit: entry.unit,
          olderThanDays: entry.keepDays,
          count
        });
    }
  }
  eligible.sort((a, b) => `${a.policyId}|${a.eventKey || ''}`.localeCompare(`${b.policyId}|${b.eventKey || ''}`));

  const reasons = [];
  if (limits?.dbBytes && totals.dbBytes >= limits.dbBytes) reasons.push('database');
  if (limits?.storageBytes && totals.storageBytes >= limits.storageBytes) reasons.push('storage');
  const triggered = reasons.length > 0;
  const items = triggered ? eligible : [];
  const planId = items.length
    ? createHash('sha256')
        .update(JSON.stringify(items.map((i) => [i.policyId, i.eventKey || null, i.count, i.olderThanDays ?? null])))
        .digest('hex')
        .slice(0, 16)
    : null;

  return {
    ...totals,
    limits: limits || null,
    season,
    activeEventKey: active || null,
    triggered,
    reasons,
    eligible,
    items,
    planId,
    generatedAt: new Date(nowMs).toISOString()
  };
}

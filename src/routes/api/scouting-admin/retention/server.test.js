import { beforeEach, describe, expect, it, vi } from 'vitest';

const access = { actorId: 'admin-1', admin: true };
const loadCleanupPlan = vi.fn();
const applyCleanupPlan = vi.fn();
const notifyDataCleanupPlan = vi.fn();
let cronAuthorized = true;

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/serviceClient.js', () => ({ getSupabase: () => ({}) }));
vi.mock('$lib/server/scouting/scoutingAccess.js', () => ({
  clientFromRequest: () => ({}),
  fetchActorProfile: async () => ({ actorId: access.actorId, profile: { id: access.actorId }, rosterKeys: [] }),
  canManageScoutingAdmin: () => access.admin
}));
vi.mock('$lib/server/retention/measure.js', () => ({ loadCleanupPlan: (...a) => loadCleanupPlan(...a) }));
vi.mock('$lib/server/retention/apply.js', () => ({ applyCleanupPlan: (...a) => applyCleanupPlan(...a) }));
vi.mock('$lib/server/integrations/cron_auth.js', () => ({ isAuthorizedCronRequest: () => cronAuthorized }));
vi.mock('$lib/server/integrations/slack_notifications.js', () => ({
  notifyDataCleanupPlan: (...a) => notifyDataCleanupPlan(...a)
}));

const request = (body) => ({ headers: new Headers(), json: async () => body });
const triggeredPlan = {
  available: true,
  triggered: true,
  reasons: ['database'],
  items: [{ policyId: 'scout_data_events', eventKey: '2026cahal', count: 8139 }],
  planId: 'aaaabbbbccccdddd'
};

describe('api/scouting-admin/retention', () => {
  beforeEach(() => {
    access.actorId = 'admin-1';
    access.admin = true;
    cronAuthorized = true;
    loadCleanupPlan.mockReset();
    applyCleanupPlan.mockReset();
    notifyDataCleanupPlan.mockReset();
  });

  it('is for scouting admins only', async () => {
    const { GET, POST } = await import('./+server.js');
    access.actorId = null;
    expect((await GET({ request: request() })).status).toBe(401);
    access.actorId = 'scout-1';
    access.admin = false;
    expect((await GET({ request: request() })).status).toBe(403);
    expect((await POST({ request: request({ action: 'approve', plan_id: 'x' }) })).status).toBe(403);
    expect(loadCleanupPlan).not.toHaveBeenCalled();
  });

  it('GET returns the dry-run plan and deletes nothing', async () => {
    loadCleanupPlan.mockResolvedValue(triggeredPlan);
    const { GET } = await import('./+server.js');
    const res = await GET({ request: request() });
    expect((await res.json()).data.planId).toBe('aaaabbbbccccdddd');
    expect(applyCleanupPlan).not.toHaveBeenCalled();
  });

  it('refuses to approve while no limit is crossed, or a plan id that no longer matches', async () => {
    const { POST } = await import('./+server.js');
    loadCleanupPlan.mockResolvedValue({ ...triggeredPlan, triggered: false, items: [], planId: null });
    expect((await POST({ request: request({ action: 'approve', plan_id: 'aaaabbbbccccdddd' }) })).status).toBe(409);
    loadCleanupPlan.mockResolvedValue(triggeredPlan);
    expect((await POST({ request: request({ action: 'approve', plan_id: 'stale' }) })).status).toBe(409);
    expect((await POST({ request: request({ action: 'approve' }) })).status).toBe(409);
    expect(applyCleanupPlan).not.toHaveBeenCalled();
  });

  it('deletes exactly the plan the admin approved', async () => {
    loadCleanupPlan.mockResolvedValue(triggeredPlan);
    applyCleanupPlan.mockResolvedValue({ deleted: [{ count: 8139 }], errors: [], logged: true });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'approve', plan_id: 'aaaabbbbccccdddd' }) });
    expect(res.status).toBe(200);
    expect(applyCleanupPlan).toHaveBeenCalledWith({}, triggeredPlan, { actorId: 'admin-1' });
  });
});

describe('api/scouting-admin/retention-cron', () => {
  beforeEach(() => {
    cronAuthorized = true;
    loadCleanupPlan.mockReset();
    applyCleanupPlan.mockReset();
    notifyDataCleanupPlan.mockReset();
  });

  it('needs the cron token', async () => {
    cronAuthorized = false;
    const { GET } = await import('../retention-cron/+server.js');
    expect((await GET({ request: request() })).status).toBe(401);
    expect(loadCleanupPlan).not.toHaveBeenCalled();
  });

  it('notifies admins when a plan is waiting and never deletes', async () => {
    loadCleanupPlan.mockResolvedValue(triggeredPlan);
    notifyDataCleanupPlan.mockResolvedValue({ ok: true, sent: 2 });
    const { POST } = await import('../retention-cron/+server.js');
    const body = await (await POST({ request: request() })).json();
    expect(body).toMatchObject({ ok: true, triggered: true, items: 1, plan_id: 'aaaabbbbccccdddd' });
    expect(notifyDataCleanupPlan).toHaveBeenCalledWith(triggeredPlan);
    expect(applyCleanupPlan).not.toHaveBeenCalled();
  });

  it('stays quiet when nothing is planned', async () => {
    loadCleanupPlan.mockResolvedValue({ ...triggeredPlan, triggered: false, items: [], planId: null });
    const { GET } = await import('../retention-cron/+server.js');
    const body = await (await GET({ request: request() })).json();
    expect(body.notified).toBeNull();
    expect(notifyDataCleanupPlan).not.toHaveBeenCalled();
  });
});

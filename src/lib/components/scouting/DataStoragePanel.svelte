<script>
  // Scouting Admin -> Data -> Storage (#125): how full the database and file storage are, and what old competition
  // data could be cleaned. Cleanup is offered only when a limit is crossed, and nothing is deleted until an admin
  // approves the exact plan shown here.
  import { onMount } from 'svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { requestConfirmation } from '$lib/app/confirmation.js';
  import { toastActions } from '$lib/app/toast.js';
  import { isPhone } from '$lib/stores/device.js';

  let plan = null;
  let loading = true;
  let error = '';
  let approving = false;
  let showAll = false;

  const mb = (bytes) => `${Math.round((Number(bytes) || 0) / (1024 * 1024))} MB`;
  const pct = (used, limit) => (limit ? Math.round((100 * used) / limit) : 0);
  const barPct = (used, limit) => Math.min(100, pct(used, limit));
  const itemLine = (item) =>
    `${item.count} ${item.unit}${item.eventKey ? ` from ${item.eventKey}` : ` older than ${item.olderThanDays} days`}`;

  $: meters = plan?.available
    ? [
        {
          label: 'Database',
          used: plan.dbBytes,
          limit: plan.limits?.dbBytes,
          crossed: plan.reasons.includes('database')
        },
        {
          label: 'File storage',
          used: plan.storageBytes,
          limit: plan.limits?.storageBytes,
          crossed: plan.reasons.includes('storage')
        }
      ]
    : [];
  $: tables = plan?.available ? (showAll ? plan.tables : plan.tables.slice(0, 6)) : [];

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await authFetch('/api/scouting-admin/retention');
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Could not load storage sizes.');
      plan = result.data;
    } catch (exception) {
      error = exception.message;
    } finally {
      loading = false;
    }
  }

  async function approve() {
    if (!plan?.planId) return;
    const total = plan.items.reduce((sum, item) => sum + item.count, 0);
    const ok = await requestConfirmation({
      title: 'Delete old competition data',
      message: `This permanently deletes ${total} items from past seasons, as listed under "Would be deleted". Scouting reports, picklists and anything from this season are never included.`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    approving = true;
    try {
      const response = await authFetch('/api/scouting-admin/retention', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve', plan_id: plan.planId })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || `Cleanup failed (${response.status})`);
      const deleted = (result.data?.deleted || []).reduce((sum, d) => sum + d.count, 0);
      const failed = result.data?.errors?.length || 0;
      toastActions.show(
        failed ? `Deleted ${deleted} items; ${failed} parts failed.` : `Deleted ${deleted} old items.`,
        5000
      );
    } catch (exception) {
      toastActions.show(exception.message, 6000);
    } finally {
      approving = false;
      await load();
    }
  }

  onMount(load);
</script>

<section class="storage" class:phone={$isPhone} aria-labelledby="storage-heading">
  <header>
    <h3 id="storage-heading">Storage</h3>
    <p>
      How full the database and file storage are. Old competition data is offered for cleanup only when a limit is
      crossed, and nothing is deleted until you approve it.
    </p>
  </header>

  {#if loading}
    <p class="muted">Loading sizes...</p>
  {:else if error}
    <p class="err">{error}</p>
  {:else if !plan?.available}
    <p class="muted">{plan?.reason}</p>
  {:else}
    <div class="meters">
      {#each meters as meter (meter.label)}
        <div class="meter" class:crossed={meter.crossed}>
          <div class="meter-head">
            <b>{meter.label}</b>
            <span>{mb(meter.used)} of {mb(meter.limit)} limit</span>
          </div>
          <div
            class="bar"
            role="meter"
            aria-label={`${meter.label} used`}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={barPct(meter.used, meter.limit)}
          >
            <span style={`width: ${barPct(meter.used, meter.limit)}%`}></span>
          </div>
          <small>{pct(meter.used, meter.limit)}% {meter.crossed ? '· over the limit' : ''}</small>
        </div>
      {/each}
    </div>

    <div class="plan">
      <h4>{plan.triggered ? 'Would be deleted' : 'Cleanup'}</h4>
      {#if plan.triggered && plan.items.length}
        <ul class="items">
          {#each plan.items as item (`${item.policyId}|${item.eventKey || ''}`)}
            <li><b>{item.label}</b><span>{itemLine(item)}</span></li>
          {/each}
        </ul>
        <button class="btn btn-outline-danger approve" disabled={approving} on:click={approve}
          >{approving ? 'Deleting...' : 'Approve cleanup'}</button
        >
      {:else if plan.triggered}
        <p>
          A limit is crossed, but nothing from a past season is old enough to clean. The biggest tables below show where
          the space is.
        </p>
      {:else}
        <p>
          Nothing to do: both are under their limits.
          {#if plan.eligible.length}
            If a limit is crossed, {plan.eligible.reduce((sum, item) => sum + item.count, 0)} old items could be cleaned.
          {:else}
            Nothing from a past season is old enough to clean yet.
          {/if}
        </p>
      {/if}
    </div>

    <div class="sizes">
      <h4>Biggest tables</h4>
      {#if $isPhone}
        <ul class="size-cards">
          {#each tables as table (table.name)}
            <li>
              <b>{table.name}</b>
              <span>{mb(table.bytes)} · {table.cleanable ? 'cleanable when old' : 'kept'}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <table>
          <thead><tr><th>Table</th><th>Size</th><th>Rows</th><th>Cleanup</th></tr></thead>
          <tbody>
            {#each tables as table (table.name)}
              <tr>
                <td>{table.name}</td>
                <td>{mb(table.bytes)}</td>
                <td>{table.rows}</td>
                <td>{table.cleanable ? 'Old rows, when a limit is crossed' : 'Kept'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if plan.tables.length > 6}
        <button class="btn btn-outline more" on:click={() => (showAll = !showAll)}
          >{showAll ? 'Show fewer' : `Show all ${plan.tables.length} tables`}</button
        >
      {/if}
      <p class="muted note">
        "Kept" covers scouting reports, picklists, rankings and the activity_log audit trail. Cleanup never touches
        those.
      </p>
    </div>
  {/if}
</section>

<style>
  .storage {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    min-width: 0;
  }
  header {
    display: grid;
    gap: 4px;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
  h4 {
    margin: 0 0 var(--space-2);
    font-size: 0.95rem;
  }
  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .muted {
    color: var(--text-secondary);
  }
  .err {
    color: var(--danger);
    font-size: 0.85rem;
  }
  .meters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .meter {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    min-width: 0;
  }
  .meter-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: 0.9rem;
  }
  .meter-head span,
  small {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  small {
    font-size: 0.8rem;
  }
  .bar {
    height: 8px;
    background: var(--surface-3);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .meter.crossed .bar span {
    background: var(--danger);
  }
  .items,
  .size-cards {
    display: grid;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    padding: 0;
    list-style: none;
  }
  .items li,
  .size-cards li {
    display: grid;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow-wrap: anywhere;
  }
  .items span,
  .size-cards span {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  th {
    color: var(--text-secondary);
    font-weight: 600;
  }
  td:nth-child(2),
  td:nth-child(3) {
    font-variant-numeric: tabular-nums;
  }
  .more {
    margin-top: var(--space-2);
  }
  .note {
    margin-top: var(--space-2);
    font-size: 0.8rem;
  }
  .phone .meters {
    grid-template-columns: 1fr;
  }
  .phone .approve,
  .phone .more {
    width: 100%;
    min-height: var(--tap-min);
  }
  .phone .items span,
  .phone .size-cards span,
  .phone small,
  .phone .note {
    font-size: max(var(--text-min), 0.8rem);
  }
</style>

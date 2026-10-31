<script>
  // Old match reports whose match box couldn't be read into a real match ("einstein match 10",
  // "35 second try"). Each one keeps what the scout typed; an admin sets the match here. See #123.
  import { onMount } from 'svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { REPORT_KIND_LABELS, reportKindOf } from '$lib/scouting/reportKinds.js';

  let reports = [];
  let problems = [];
  let loading = true;
  let error = '';
  let drafts = {};
  let saving = '';
  let rowErrors = {};

  const team = (key) => String(key || '').replace(/^frc/, '');
  const rowId = (kind, row) => `${kind}:${row.id}`;
  $: items = [
    ...reports.map((row) => ({
      kind: 'report',
      row,
      title: `Team ${team(row.team_key)} · ${REPORT_KIND_LABELS[reportKindOf(row)]}`,
      detail: row.scout_name || 'Unknown scout'
    })),
    ...problems.map((row) => ({
      kind: 'problem',
      row,
      title: `Team ${team(row.team_key)} · pit problem${row.resolved ? ' (resolved)' : ''}`,
      detail: row.summary || ''
    }))
  ];

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await fetch('/api/scouting-admin?resource=match-key-review', { headers: await getAuthHeader() });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Could not load reports to review.');
      ({ reports, problems } = result.data);
    } catch (exception) {
      error = exception.message;
    } finally {
      loading = false;
    }
  }

  async function save(item) {
    const id = rowId(item.kind, item.row);
    saving = id;
    rowErrors = { ...rowErrors, [id]: '' };
    try {
      const response = await fetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ action: 'fix-match-key', kind: item.kind, id: item.row.id, match: drafts[id] || '' })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Could not save the match.');
      if (item.kind === 'report') reports = reports.filter((row) => row.id !== item.row.id);
      else problems = problems.filter((row) => row.id !== item.row.id);
    } catch (exception) {
      rowErrors = { ...rowErrors, [id]: exception.message };
    } finally {
      saving = '';
    }
  }

  onMount(load);
</script>

<section class="review">
  <header>
    <h3>Match numbers to review</h3>
    <p>
      Old reports where the match box couldn't be read. Each keeps what the scout typed; enter the real match (12 for
      Qual 12, sf2m1 or f1m2 for playoffs).
    </p>
  </header>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error}
    <p class="err">{error}</p>
  {:else if !items.length}
    <p class="muted">Every report has a readable match.</p>
  {:else}
    <ul>
      {#each items as item (rowId(item.kind, item.row))}
        {@const id = rowId(item.kind, item.row)}
        <li>
          <div class="info">
            <b>{item.title}</b>
            <span class="typed">Typed: “{item.row.match_label || item.row.match_key}”</span>
            <small>{item.row.event_key}{item.detail ? ` · ${item.detail}` : ''}</small>
          </div>
          <form class="fix" on:submit|preventDefault={() => save(item)}>
            <input
              class="form-input"
              inputmode="numeric"
              placeholder="Match"
              aria-label={`Match for ${item.title}`}
              bind:value={drafts[id]}
            />
            <button class="btn btn-primary" disabled={saving === id || !String(drafts[id] || '').trim()}
              >{saving === id ? 'Saving…' : 'Save'}</button
            >
          </form>
          {#if rowErrors[id]}<p class="err">{rowErrors[id]}</p>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .review {
    display: grid;
    gap: var(--space-3);
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
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    min-width: 0;
    padding: var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .info {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .info b,
  .typed,
  small {
    overflow-wrap: anywhere;
  }
  .typed {
    font-size: 0.9rem;
  }
  small {
    color: var(--text-secondary);
    font-size: 0.8rem;
  }
  .fix {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
  }
  .fix input {
    flex: 1;
    min-width: 0;
  }
  .fix button {
    flex: none;
  }
  @media (max-width: 900px) {
    /* Phone: full-width cards, controls at tap size. */
    .review {
      padding: var(--space-4);
    }
    .fix input,
    .fix button {
      min-height: var(--tap-min, 44px);
    }
  }
</style>

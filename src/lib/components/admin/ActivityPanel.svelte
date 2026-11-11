<script>
  // Scouting Admin > People > Activity: every change made in the app, newest first, with who made it and what
  // changed. Search filters what's loaded; the area dropdown asks the server for one kind of record.
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ChevronDown, Search } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { ACTIVITY_AREAS, filterActivity } from '$lib/app/activityLog.js';
  import { formatLocalDateTime } from '$lib/app/timezone.js';

  let entries = [];
  let more = null;
  let loading = true;
  let error = '';
  let query = '';
  let table = '';
  let open = new Set();

  // One option per area, even where several tables share a name.
  const AREA_OPTIONS = [...new Map(Object.entries(ACTIVITY_AREAS).map(([key, label]) => [label, key])).entries()].sort(
    ([a], [b]) => a.localeCompare(b)
  );

  async function load({ append = false } = {}) {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams();
      if (table) params.set('table', table);
      if (append && more) params.set('before', String(more));
      const response = await authFetch(`/api/activity-log?${params}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not load the activity log.');
      entries = append ? [...entries, ...result.entries] : result.entries;
      more = result.more;
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }
  onMount(() => load());

  $: shown = filterActivity(entries, query);
  const toggle = (id) => {
    open = new Set(open);
    if (open.has(id)) open.delete(id);
    else open.add(id);
  };
  const tone = (operation) => (operation === 'INSERT' ? 'add' : operation === 'DELETE' ? 'remove' : 'change');
</script>

<section class="activity" aria-label="Activity">
  <div class="act-bar">
    <label class="act-search">
      <Search size={15} />
      <input
        type="search"
        placeholder="Search people, records and fields"
        aria-label="Search activity"
        bind:value={query}
      />
    </label>
    <Select bind:value={table} on:change={() => load()} aria-label="Area">
      <option value="">Every area</option>
      {#each AREA_OPTIONS as [label, key] (key)}<option value={key}>{label}</option>{/each}
    </Select>
  </div>

  {#if error}<div class="status-message status-error" role="alert">{error}</div>{/if}

  {#if loading && !entries.length}
    <p class="muted">Loading activity…</p>
  {:else if !shown.length}
    <p class="muted">{query ? `Nothing matches "${query}".` : 'Nothing has been recorded yet.'}</p>
  {:else}
    <ol class="act-list">
      {#each shown as entry (entry.id)}
        <li>
          <button
            type="button"
            class="act-row"
            aria-expanded={open.has(entry.id)}
            disabled={!entry.changes.length}
            on:click={() => toggle(entry.id)}
          >
            <span class="act-dot {tone(entry.operation)}" aria-hidden="true"></span>
            <span class="act-text">
              <span class="act-line"
                ><b>{entry.actor}</b>
                {entry.verb.toLowerCase()}
                <span class="act-area">{entry.area.toLowerCase()}</span>{#if entry.subject}
                  · <span class="act-subject">{entry.subject}</span>{/if}</span
              >
              <small
                >{entry.at ? formatLocalDateTime(entry.at) : ''}{#if entry.changes.length}
                  · {entry.changes.length} field{entry.changes.length === 1 ? '' : 's'}{/if}</small
              >
            </span>
            {#if entry.changes.length}<ChevronDown size={16} class={open.has(entry.id) ? 'turned' : ''} />{/if}
          </button>
          {#if open.has(entry.id)}
            <dl class="act-changes" transition:slide={{ duration: 160 }}>
              {#each entry.changes as change (change.field)}
                <dt>{change.field}</dt>
                <dd><s>{change.from}</s><span aria-hidden="true">→</span><b>{change.to}</b></dd>
              {/each}
            </dl>
          {/if}
        </li>
      {/each}
    </ol>
    {#if more && !query}
      <button class="btn btn-outline btn-sm load-more" disabled={loading} on:click={() => load({ append: true })}
        >{loading ? 'Loading…' : 'Show older'}</button
      >
    {/if}
  {/if}
</section>

<style>
  .activity {
    display: grid;
    gap: var(--space-4);
    max-width: 56rem;
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
  }
  .act-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(10rem, 14rem);
    gap: var(--space-2);
    align-items: center;
  }
  .act-bar :global(.form-group) {
    margin: 0;
  }
  .act-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-1);
    color: var(--text-muted);
  }
  .act-search:focus-within {
    border-color: var(--accent);
  }
  .act-search input {
    flex: 1;
    min-width: 0;
    min-height: 2.5rem;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: max(16px, 0.92rem);
  }
  .act-list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .act-list li + li {
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .act-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .act-row:disabled {
    cursor: default;
  }
  .act-row:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }
  .act-row :global(svg) {
    flex: none;
    color: var(--text-muted);
    transition: transform 0.18s ease;
  }
  .act-row :global(.turned) {
    transform: rotate(180deg);
  }
  .act-dot {
    flex: none;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .act-dot.add {
    background: var(--success);
  }
  .act-dot.remove {
    background: var(--danger);
  }
  .act-dot.change {
    background: var(--accent);
  }
  .act-text {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .act-line {
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .act-line b,
  .act-subject {
    color: var(--text-strong, var(--text));
    font-weight: 500;
  }
  .act-text small {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .act-changes {
    display: grid;
    grid-template-columns: minmax(7rem, 12rem) minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
    padding: 0 var(--space-4) var(--space-3) calc(var(--space-4) + 0.55rem + var(--space-3));
    font-size: 0.85rem;
  }
  .act-changes dt {
    color: var(--text-muted);
    text-transform: capitalize;
  }
  .act-changes dd {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .act-changes s {
    color: var(--text-muted);
  }
  .act-changes b {
    font-weight: 500;
  }
  .load-more {
    justify-self: center;
  }
  @media (max-width: 700px) {
    .act-bar {
      grid-template-columns: 1fr;
    }
    .act-changes {
      grid-template-columns: 1fr;
      padding-left: var(--space-4);
    }
  }
</style>

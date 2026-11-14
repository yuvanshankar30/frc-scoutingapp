<script>
  // Scout entries: every match scouting report under the filters, latest match first. Each opens its own page with
  // every answer. The search box finds a team, match, report kind or scout.
  import { ChevronRight } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { useDataViewer } from '$lib/components/dataViewer/state.js';
  import { formatPacificDateTimeWithZone } from '$lib/app/timezone.js';
  import { KIND_LABELS, entryList, filterRecords } from '$lib/scouting/dataViewer.js';

  const { filters, search, records } = useDataViewer();
  const PAGE = 60;
  let shown = PAGE;

  $: entries = entryList(filterRecords($records.match, 'match', $filters), $search);
  // A new filter starts the list from the top again.
  $: if (entries) shown = PAGE;
  const entryHref = (entry) => `/dataviewer/entries/${encodeURIComponent(entry.id)}`;
  const when = (value) => (value ? formatPacificDateTimeWithZone(value) : '—');
</script>

<svelte:head><title>Scout entries · Data Viewer</title></svelte:head>

<div class="entries" class:phone={$isPhone}>
  <p class="summary">
    {entries.length}
    {entries.length === 1 ? 'entry' : 'entries'} · match scouting only · open one to see every answer
  </p>

  {#if !entries.length}
    <div class="empty-state">
      {$records.match.length ? 'No entry matches these filters.' : 'No match scouting at this event yet.'}
    </div>
  {:else if $isPhone}
    <ul class="list">
      {#each entries.slice(0, shown) as entry (entry.id)}
        <li>
          <a href={entryHref(entry)}>
            <span class="top">
              <b class="team">{entry.team}</b>
              <span>{entry.match}</span>
              <span class={`kind kind-${entry.kind}`}>{KIND_LABELS[entry.kind]}</span>
            </span>
            <span class="sub">{entry.scout ?? 'Scout not recorded'} · {when(entry.at)}</span>
            <ChevronRight size={18} class="go" aria-hidden="true" />
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="table-wrap">
      <table class="table" data-keep-table>
        <thead>
          <tr>
            <th>Match</th>
            <th>Team</th>
            <th>Report</th>
            <th>Scout</th>
            <th>Submitted</th>
            <th><span class="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {#each entries.slice(0, shown) as entry (entry.id)}
            <tr>
              <td><a class="row-link" href={entryHref(entry)}>{entry.match}</a></td>
              <td class="team">{entry.team}</td>
              <td><span class={`kind kind-${entry.kind}`}>{KIND_LABELS[entry.kind]}</span></td>
              <td>{entry.scout ?? '—'}</td>
              <td class="muted">{when(entry.at)}</td>
              <td class="go-cell"><ChevronRight size={16} aria-hidden="true" /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if entries.length > shown}
    <button class="btn btn-outline more" on:click={() => (shown += PAGE)}
      >Show {Math.min(PAGE, entries.length - shown)} more of {entries.length - shown}</button
    >
  {/if}
</div>

<style>
  .entries {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3);
  }
  .summary {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .table-wrap {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .table {
    margin: 0;
    width: 100%;
    font-size: 0.9rem;
  }
  /* The whole row opens the entry: the Match link's hit area covers the row. */
  tbody tr {
    position: relative;
    transition: background-color 0.15s ease;
  }
  tbody tr:hover {
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  .row-link {
    color: var(--text-strong, var(--text));
    font-weight: 500;
    text-decoration: none;
  }
  .row-link::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .team {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .muted {
    color: var(--text-muted);
  }
  .go-cell {
    width: 2rem;
    color: var(--text-muted);
  }
  .kind {
    display: inline-block;
    padding: 1px 10px;
    border-radius: var(--radius-full);
    font-size: max(var(--text-min), 0.78rem);
    font-weight: 500;
    background: var(--surface-3);
    color: var(--text-secondary);
  }
  .kind-data {
    background: color-mix(in srgb, var(--chart-orange) 18%, transparent);
  }
  .kind-performance {
    background: color-mix(in srgb, var(--chart-blue) 18%, transparent);
  }
  .kind-robot {
    background: color-mix(in srgb, var(--chart-danger) 18%, transparent);
  }
  .more {
    justify-self: start;
  }

  /* Phones: a list of tappable rows. */
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .list a {
    position: relative;
    display: grid;
    gap: 4px;
    min-height: var(--tap-min);
    padding: var(--space-3) 2.5rem var(--space-3) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: inherit;
    text-decoration: none;
  }
  .list a:active {
    background: var(--surface-2);
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .sub {
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.82rem);
    overflow-wrap: anywhere;
  }
  .list a :global(.go) {
    position: absolute;
    right: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
  }
  .phone .more {
    justify-self: stretch;
    min-height: var(--tap-min);
  }
  @media (prefers-reduced-motion: reduce) {
    tbody tr {
      transition: none;
    }
  }
</style>

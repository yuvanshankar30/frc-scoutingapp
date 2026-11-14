<script>
  // Data Viewer's frame: header, the Match / Pit / Scout entries tabs, the filters (a sheet on phones) and the event's
  // scouting, loaded once here for the overview (+page), a field's page (field/[form]/[id]) and the scout entries
  // (entries, entries/[id]). Moving between them slides the new page in.
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { Download, RefreshCw, SlidersHorizontal } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import BottomSheet from '$lib/components/common/BottomSheet.svelte';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';
  import Filters from '$lib/components/dataViewer/Filters.svelte';
  import { createDataViewer, provideDataViewer } from '$lib/components/dataViewer/state.js';
  import {
    emptyFilters,
    filterFields,
    filterRecords,
    lastQualNumber,
    teamOptions,
    viewToCsv
  } from '$lib/scouting/dataViewer.js';

  const state = createDataViewer();
  provideDataViewer(state);
  const {
    activeEventKey,
    selectedEventKey,
    availableEvents,
    eventKey,
    report,
    teamNames,
    loading,
    error,
    loadedEventKey,
    form,
    filters,
    search,
    hideEmpty,
    records,
    fields
  } = state;

  let filtersOpen = false;

  $: path = $page.url.pathname;
  // Which part of the Data Viewer is open: a form's pages (overview and fields), or one of the other tabs.
  $: route = ['rankings', 'entries', 'agent'].find((key) => path.startsWith(`/dataviewer/${key}`)) || 'form';
  $: onOverview = path === '/dataviewer' || path === '/dataviewer/';
  $: onEntries = route === 'entries';
  // Rankings and scout entries are match reports, so their filters are the match ones.
  $: viewForm = route === 'form' ? $form : 'match';
  $: tab = route === 'form' ? $form : route;
  // Rankings rank every team (no team, kind or search filter); the agent has no filters.
  $: showFilters = route !== 'agent';
  $: rankingFilters = route === 'rankings';
  $: canExport = route === 'form' || route === 'entries';
  $: activeEventLabel =
    $availableEvents.find((option) => option.value === $activeEventKey)?.label || $activeEventKey || 'not set';
  $: browseEventOptions = $availableEvents.filter((option) => option.value !== $activeEventKey);
  $: shownRecords = filterRecords($records[viewForm], viewForm, $filters);
  $: teamChoices = teamOptions([...$records.match, ...$records.pit], $teamNames).filter(
    (option) => !$filters.teams.includes(option.value)
  );
  $: lastQual = lastQualNumber($records.match);
  $: matchFilters = viewForm === 'match';
  $: activeFilters =
    (rankingFilters ? 0 : $filters.teams.length + Number(!!$search.trim())) +
    (matchFilters
      ? Number(!!$filters.matchType) +
        Number(!rankingFilters && !!$filters.kind) +
        Number($filters.fromMatch != null) +
        Number($filters.toMatch != null)
      : 0) +
    Number(onOverview && $hideEmpty);
  $: searchPlaceholder = onEntries ? 'Find a team, match or scout' : 'Find a field';

  // The Agent tab always shows; the agent itself stays off until ANALYSIS_AGENT_ENABLED (its page says so).
  const TABS = [
    { key: 'match', label: 'Match scouting', short: 'Match' },
    { key: 'pit', label: 'Pit scouting', short: 'Pit' },
    { key: 'rankings', label: 'Rankings', short: 'Ranks' },
    { key: 'entries', label: 'Scout entries', short: 'Entries' },
    { key: 'agent', label: 'Agent', short: 'Agent' }
  ];
  // Report counts on the form and entries tabs; Rankings and Agent have none.
  const tabCount = (key, all) =>
    key === 'entries' ? all.match.length : key === 'match' || key === 'pit' ? all[key].length : null;

  function openTab(key) {
    if (key !== 'match' && key !== 'pit') return goto(`/dataviewer/${key}`);
    form.set(key);
    return onOverview ? null : goto('/dataviewer');
  }

  function clearFilters() {
    filters.set(emptyFilters());
    search.set('');
    hideEmpty.set(false);
  }

  function downloadCsv() {
    const shownFields = filterFields($fields[viewForm], $filters);
    const csv = viewToCsv(viewForm, shownFields, shownRecords);
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), {
      href,
      download: `data-viewer-${$eventKey || 'event'}-${viewForm}.csv`
    });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  onMount(() => state.start());
  $: if ($eventKey && $eventKey !== $loadedEventKey && !$loading) void state.load();
</script>

<div class="data-viewer" class:phone={$isPhone}>
  <header class="page-head">
    <div>
      <h1>Data Viewer</h1>
      <p>Every answer from match and pit scouting, as charts and as text.</p>
    </div>
    <div class="head-actions">
      <SeasonFilter
        hideLabel
        options={browseEventOptions}
        bind:value={$selectedEventKey}
        allLabel={`Current Event (${activeEventLabel})`}
      />
      {#if !$isPhone && canExport}
        <button class="btn btn-outline" on:click={downloadCsv} disabled={$loading || !shownRecords.length}
          ><Download size={16} /> CSV</button
        >
      {/if}
      <button class="btn btn-outline" on:click={state.load} disabled={$loading || !$eventKey} aria-label="Refresh"
        ><RefreshCw size={16} />{#if !$isPhone}Refresh{/if}</button
      >
    </div>
  </header>

  <div class="tabs" role="tablist" aria-label="Data Viewer" style={`--tab-count:${TABS.length}`}>
    {#each TABS as entry (entry.key)}
      <button
        role="tab"
        aria-selected={tab === entry.key}
        class:on={tab === entry.key}
        on:click={() => openTab(entry.key)}
        >{$isPhone ? entry.short : entry.label}{#if !$isPhone && tabCount(entry.key, $records) !== null}<span
            class="tab-count">{tabCount(entry.key, $records)}</span
          >{/if}</button
      >
    {/each}
  </div>

  {#if !$eventKey && !$loading}
    <div class="empty-state">Set an active scouting event in Scouting Admin to see its data.</div>
  {:else if $loading && !$report}
    <div class="empty-state">Loading scouting data...</div>
  {:else if $error}
    <div class="notice notice-error" role="alert">{$error}</div>
  {:else}
    {#if !$isPhone && showFilters}
      <section class="filters" aria-label="Filters">
        <Filters
          {searchPlaceholder}
          {teamChoices}
          {lastQual}
          showSearch={!rankingFilters}
          showTeams={!rankingFilters}
          showMatches={matchFilters}
          showKind={matchFilters && !rankingFilters}
          showHideEmpty={onOverview}
        >
          {#if activeFilters}
            <button class="btn btn-ghost clear" on:click={clearFilters} transition:fade={{ duration: 120 }}
              >Clear filters</button
            >
          {/if}
        </Filters>
      </section>
    {/if}

    {#key path}
      <div class="view" in:fly={{ y: 10, duration: 220, easing: cubicOut }}>
        <slot />
      </div>
    {/key}

    {#if $isPhone && showFilters}
      <button type="button" class="pd-dock btn btn-primary" on:click={() => (filtersOpen = true)}
        ><SlidersHorizontal size={18} /> Filters{#if activeFilters}<span class="dock-count">{activeFilters}</span
          >{/if}</button
      >
    {/if}
  {/if}
</div>

{#if $isPhone}
  <BottomSheet
    open={filtersOpen}
    title="Filters"
    subtitle={`${shownRecords.length} reports`}
    on:close={() => (filtersOpen = false)}
  >
    <div class="sheet-filters">
      <Filters
        phone
        {searchPlaceholder}
        {teamChoices}
        {lastQual}
        showSearch={!rankingFilters}
        showTeams={!rankingFilters}
        showMatches={matchFilters}
        showKind={matchFilters && !rankingFilters}
        showHideEmpty={onOverview}
      />
      <div class="sheet-actions">
        <button class="btn btn-outline" on:click={clearFilters} disabled={!activeFilters}>Clear</button>
        <button class="btn btn-outline" on:click={downloadCsv} disabled={!canExport || !shownRecords.length}
          ><Download size={16} /> CSV</button
        >
        <button class="btn btn-primary" on:click={() => (filtersOpen = false)}>Done</button>
      </div>
    </div>
  </BottomSheet>
{/if}

<style>
  /* One column that never grows past the page: nothing inside can push the page sideways. */
  .data-viewer {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
    width: 100%;
    min-width: 0;
  }
  .page-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .page-head h1 {
    margin: 0;
    font-size: clamp(1.75rem, 2.8vw, 2.3rem);
    font-weight: 500;
    letter-spacing: -0.03em;
    color: var(--text-strong, var(--text));
  }
  .page-head p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
  }
  .head-actions {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .head-actions :global(.form-group) {
    margin: 0;
  }
  .head-actions .btn {
    height: auto;
    min-height: 2.5rem;
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding-bottom: var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.25rem;
    padding: 0 var(--space-4);
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .tabs button:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
    color: var(--text-strong, var(--text));
  }
  .tabs button.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-strong, var(--text));
  }
  .tab-count {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .filters {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .clear {
    min-height: 2.5rem;
  }

  .view {
    min-width: 0;
  }

  /* Phones: three equal tabs, filters in a sheet, the Filters button docked above the bottom bar. */
  .phone {
    padding-bottom: 4.5rem;
  }
  /* Phones: one even row of tabs, labels only (the counts are in the stats below), each tab a full-width pill. */
  .phone .tabs {
    display: grid;
    grid-template-columns: repeat(var(--tab-count, 5), minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-1);
  }
  .phone .tabs button {
    justify-content: center;
    min-width: 0;
    min-height: var(--tap-min);
    padding: 0 2px;
    font-size: max(var(--text-min), 0.85rem);
  }
  .phone .head-actions {
    width: 100%;
    flex-wrap: nowrap;
  }
  .phone .head-actions .btn {
    min-width: var(--tap-min);
    min-height: var(--tap-min);
    justify-content: center;
  }
  .pd-dock {
    position: fixed;
    left: calc(var(--page-gutter) + var(--safe-left));
    right: calc(var(--page-gutter) + var(--safe-right));
    bottom: calc(var(--dock-height) + var(--space-2));
    z-index: 10;
    min-height: var(--tap-comfort);
    justify-content: center;
    gap: var(--space-2);
    font-size: 1rem;
    box-shadow: var(--shadow-dock);
  }
  .dock-count {
    display: inline-grid;
    place-items: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, currentColor 22%, transparent);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .sheet-filters {
    display: grid;
    gap: var(--space-4);
    padding-bottom: var(--space-3);
  }
  .sheet-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .sheet-actions .btn {
    min-height: var(--tap-min);
    justify-content: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .tabs button {
      transition: none;
    }
  }
</style>

<script>
  // The Data Viewer's filters, shared by the desktop filter bar and the phone's filter sheet. Which controls show
  // depends on the page: Rankings has no search, team or report-kind filter; pit scouting has no match filters.
  import { fade } from 'svelte/transition';
  import { Search, X } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import TeamPicker from '$lib/components/common/TeamPicker.svelte';
  import { useDataViewer } from './state.js';
  import { MATCH_TYPES, REPORT_KIND_OPTIONS, teamNumber } from '$lib/scouting/dataViewer.js';

  export let phone = false;
  export let searchPlaceholder = 'Find a field';
  export let showSearch = true;
  export let showTeams = true;
  export let showMatches = true;
  export let showKind = true;
  export let showHideEmpty = false;
  /** [{ value, number, name }] teams not picked yet. */
  export let teamChoices = [];
  /** The last qualification match scouted, as the range's placeholder. */
  export let lastQual = 0;

  const { filters, search, hideEmpty, teamNames } = useDataViewer();
  let pickedTeam = '';

  function addTeam(key) {
    if (key && !$filters.teams.includes(key)) filters.update((value) => ({ ...value, teams: [...value.teams, key] }));
    pickedTeam = '';
  }
  const removeTeam = (key) => filters.update((value) => ({ ...value, teams: value.teams.filter((t) => t !== key) }));

  // Typed match numbers: blank clears the bound, anything else becomes a whole number of at least 1.
  function setMatchBound(which, raw) {
    const value = String(raw ?? '').trim() === '' ? null : Math.max(1, Math.trunc(Number(raw)) || 1);
    filters.update((current) => ({ ...current, [which]: value }));
  }
  const teamLabel = (key) => `${teamNumber(key)}${$teamNames.get(key) ? ` · ${$teamNames.get(key)}` : ''}`;
</script>

<div class="filter-controls" class:phone>
  {#if showSearch}
    <label class="search">
      <Search size={16} aria-hidden="true" />
      <input class="form-input" type="search" placeholder={searchPlaceholder} bind:value={$search} />
    </label>
  {/if}
  {#if showTeams}
    <div class="filter team-filter">
      <span class="cap">Teams</span>
      <TeamPicker
        options={teamChoices}
        bind:value={pickedTeam}
        on:change={(event) => addTeam(event.detail)}
        ariaLabel="Add a team"
        placeholder="Add a team"
      />
    </div>
  {/if}
  {#if showMatches}
    <div class="filter">
      <span class="cap">Matches</span>
      <Select bind:value={$filters.matchType} class="form-select" aria-label="Match type">
        {#each MATCH_TYPES as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
      </Select>
    </div>
    <div class="filter">
      <span class="cap">{phone ? 'Qualification matches' : 'Quals'}</span>
      <span class="range-inputs">
        <input
          class="form-input"
          type="number"
          inputmode="numeric"
          min="1"
          placeholder="From"
          aria-label="From qualification match"
          value={$filters.fromMatch ?? ''}
          on:change={(event) => setMatchBound('fromMatch', event.currentTarget.value)}
        />
        <span aria-hidden="true">–</span>
        <input
          class="form-input"
          type="number"
          inputmode="numeric"
          min="1"
          placeholder={lastQual ? String(lastQual) : 'To'}
          aria-label="To qualification match"
          value={$filters.toMatch ?? ''}
          on:change={(event) => setMatchBound('toMatch', event.currentTarget.value)}
        />
      </span>
    </div>
  {/if}
  {#if showKind}
    <div class="filter">
      <span class="cap">Report</span>
      <Select bind:value={$filters.kind} class="form-select" aria-label="Report kind">
        {#each REPORT_KIND_OPTIONS as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
      </Select>
    </div>
  {/if}
  {#if showHideEmpty}
    <label class="check">
      <input type="checkbox" bind:checked={$hideEmpty} />
      {phone ? 'Hide unanswered fields' : 'Hide unanswered'}
    </label>
  {/if}
  <slot />
</div>

{#if showTeams && $filters.teams.length}
  <ul class="chips" class:phone aria-label="Teams shown">
    {#each $filters.teams as key (key)}
      <li in:fade={{ duration: 120 }}>
        <span>{teamLabel(key)}</span>
        <button type="button" on:click={() => removeTeam(key)} aria-label={`Remove team ${teamNumber(key)}`}
          ><X size={phone ? 16 : 14} /></button
        >
      </li>
    {/each}
  </ul>
{/if}

<style>
  /* Desktop: one wrapping row of labelled controls, all the same height. */
  .filter-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
  }
  .filter {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .filter :global(.form-group) {
    margin: 0;
  }
  .team-filter {
    min-width: 12rem;
  }
  .cap {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 14rem;
    min-width: 0;
  }
  .search :global(svg) {
    position: absolute;
    left: var(--space-3);
    color: var(--text-muted);
    pointer-events: none;
  }
  .search input {
    width: 100%;
    padding-left: 2.25rem;
  }
  .range-inputs {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
  }
  .range-inputs input {
    width: 5rem;
    min-width: 0;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
    cursor: pointer;
  }
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chips li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-1);
    font-size: 0.88rem;
  }
  .chips button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .chips button:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  /* Phones (inside the filter sheet): one control per row, 44px targets, 16px fields so iOS doesn't zoom. */
  .filter-controls.phone {
    display: grid;
    gap: var(--space-4);
  }
  .phone .search {
    flex: none;
  }
  .phone input {
    min-height: var(--tap-min);
    font-size: 16px;
  }
  .phone .range-inputs input {
    flex: 1;
    width: auto;
  }
  .phone .check {
    min-height: var(--tap-min);
    font-size: 1rem;
  }
  .chips.phone button {
    width: var(--tap-min);
    height: var(--tap-min);
  }
</style>

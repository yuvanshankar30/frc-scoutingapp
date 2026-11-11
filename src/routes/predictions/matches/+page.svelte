<script>
  import { Search } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { pmEventKey } from '$lib/stores/predictionMarketEvent.js';

  let query = '';
  let loading = true;
  let error = '';
  let matches = [];

  $: needle = query.trim().toLowerCase();
  $: filtered = matches.filter(
    (m) => !needle || m.match_key.includes(needle) || [...m.red_teams, ...m.blue_teams].some((t) => t.includes(needle))
  );

  const STATUS_LABEL = { upcoming: 'Upcoming', locked: 'Locked', completed: 'Final' };

  async function loadMatches(eventKey) {
    if (!eventKey) {
      loading = false;
      return;
    }
    loading = true;
    error = '';
    try {
      const authHeaders = await getAuthHeader();
      const response = await fetch(`/api/prediction-market-v2/matches?event_key=${encodeURIComponent(eventKey)}`, {
        headers: authHeaders
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Could not load matches.');
      matches = Array.isArray(result) ? result : [];
    } catch (cause) {
      error = cause?.message || 'Could not load matches.';
    } finally {
      loading = false;
    }
  }

  $: loadMatches($pmEventKey);
</script>

<svelte:head><title>Matches — Prediction Market</title></svelte:head>

<div class="pm-page-header">
  <h1>Matches</h1>
  <div class="pm-search">
    <Search size={14} />
    <input type="search" placeholder="Search match or team…" bind:value={query} />
  </div>
</div>

<section class="pm-panel">
  {#if $isPhone}
    <!-- Phone: one row per match with the pick and a big Predict / View button. -->
    <ul class="pm-mrows">
      {#each filtered as m}
        <li>
          <a class="pm-mrows-main" href="/predictions/matches/{m.match_key}">
            <b class="pm-match-key">{m.match_key.split('_').pop().toUpperCase()}</b>
            <span class="pm-mrows-teams"
              ><span class="pm-alliance-red">{m.red_teams.join(' ')}</span><span class="pm-alliance-blue"
                >{m.blue_teams.join(' ')}</span
              ></span
            >
            <span class="pm-mrows-meta"
              ><b>{Math.round(m.model_probability_red * 100)}%</b><small>{STATUS_LABEL[m.status]}</small
              >{#if m.my_pick}<span class="pm-side-chip pm-side-{m.my_pick}">{m.my_pick}</span>{/if}</span
            >
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="pm-table-scroll">
      <table class="pm-table">
        <thead>
          <tr>
            <th>Match</th>
            <th>Red</th>
            <th>Blue</th>
            <th class="pm-num">Model (Red)</th>
            <th>My Pick</th>
            <th>Status</th>
            <th class="pm-action-col"></th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as m}
            <tr>
              <td class="pm-match-key"><a href="/predictions/matches/{m.match_key}">{m.match_key.toUpperCase()}</a></td>
              <td class="pm-alliance-red pm-mono">{m.red_teams.join(' · ')}</td>
              <td class="pm-alliance-blue pm-mono">{m.blue_teams.join(' · ')}</td>
              <td class="pm-num pm-model">{Math.round(m.model_probability_red * 100)}%</td>
              <td>
                {#if m.my_pick}
                  <span class="pm-side-chip pm-side-{m.my_pick}">{m.my_pick}</span>
                {:else}
                  <span class="pm-muted-text">—</span>
                {/if}
              </td>
              <td>
                <span class="pm-status-chip" class:pm-status-live={m.status === 'upcoming'}
                  >{STATUS_LABEL[m.status]}</span
                >
              </td>
              <td class="pm-action-col"
                ><a href="/predictions/matches/{m.match_key}" class="pm-btn pm-btn-accent"
                  >{m.my_pick ? 'View' : 'Predict'}</a
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
      {#if loading}
        <p class="pm-empty">Loading matches…</p>
      {:else if error}
        <p class="pm-empty">{error}</p>
      {:else if !filtered.length}
        <p class="pm-empty">{query ? `No matches match "${query}".` : 'No matches for this event yet.'}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .pm-page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.1rem;
    flex-wrap: wrap;
  }
  .pm-page-header h1 {
    margin: 0;
    font-family: var(--pm-font-mono);
    font-size: 1.3rem;
  }
  .pm-search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: var(--pm-surface);
    border: 1px solid var(--pm-border);
    color: var(--pm-muted);
    min-width: 260px;
  }
  .pm-search input {
    flex: 1;
    background: none;
    border: none;
    color: var(--pm-text);
    font: inherit;
    outline: none;
  }

  .pm-panel {
    background: var(--pm-surface);
    border: 1px solid var(--pm-border);
  }
  .pm-table-scroll {
    overflow-x: auto;
  }
  .pm-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .pm-table th {
    text-align: left;
    padding: 0.6rem 1.1rem;
    color: var(--pm-muted);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    border-bottom: 1px solid var(--pm-border);
  }
  .pm-table th.pm-num {
    text-align: right;
  }
  .pm-table td {
    padding: 0.65rem 1.1rem;
    border-bottom: 1px solid var(--pm-border-soft);
  }
  .pm-table tbody tr:last-child td {
    border-bottom: none;
  }
  .pm-table tbody tr:hover {
    background: var(--pm-surface-raised);
  }
  .pm-num {
    text-align: right;
    font-family: var(--pm-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .pm-mono {
    font-family: var(--pm-font-mono);
    font-size: 0.78rem;
  }
  .pm-match-key a {
    color: var(--pm-text);
    text-decoration: none;
    font-family: var(--pm-font-mono);
    font-weight: 600;
  }
  .pm-match-key a:hover {
    color: var(--pm-accent);
  }
  .pm-alliance-red {
    color: var(--pm-red);
  }
  .pm-alliance-blue {
    color: var(--pm-blue);
  }
  .pm-model {
    color: var(--pm-accent);
    font-weight: 600;
  }
  .pm-action-col {
    text-align: right;
  }
  .pm-muted-text {
    color: var(--pm-muted);
  }

  .pm-side-chip {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    font-family: var(--pm-font-mono);
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .pm-side-red {
    background: var(--pm-red-soft);
    color: var(--pm-red);
  }
  .pm-side-blue {
    background: var(--pm-blue-soft);
    color: var(--pm-blue);
  }

  .pm-status-chip {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    font-size: 0.72rem;
    background: var(--pm-border-soft);
    color: var(--pm-muted);
  }
  .pm-status-chip.pm-status-live {
    background: var(--pm-green-soft);
    color: var(--pm-green);
  }

  .pm-btn-accent {
    display: inline-block;
    padding: 0.4rem 0.85rem;
    background: var(--pm-accent);
    color: var(--accent-contrast);
    text-decoration: none;
    font-size: 0.78rem;
    font-weight: 600;
    transition:
      filter 0.12s ease,
      transform 0.12s ease;
  }
  .pm-btn-accent:hover {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }

  .pm-empty {
    padding: 1.5rem 1.1rem;
    color: var(--pm-muted);
    font-size: 0.85rem;
    margin: 0;
  }

  .pm-mrows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pm-mrows li + li {
    border-top: 1px solid var(--border);
  }
  .pm-mrows-main {
    display: grid;
    grid-template-columns: 3.4rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    min-height: 56px;
    padding: 6px 4px;
    color: var(--text);
    text-decoration: none;
  }
  .pm-mrows-teams {
    display: grid;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: 0.82rem;
  }
  .pm-mrows-teams span {
    padding: 1px 6px;
    border-radius: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pm-mrows-meta {
    display: grid;
    justify-items: end;
    gap: 2px;
    font-family: var(--font-mono);
  }
  .pm-mrows-meta small {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-family: var(--font-body);
  }
  @media (max-width: 900px) {
    .pm-page-header {
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .pm-search {
      width: 100%;
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .pm-mrows-teams span {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

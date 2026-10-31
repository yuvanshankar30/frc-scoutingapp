<script>
  // Team View's landing page: every team at the event as a card (photo, number, name, rank,
  // record, OPR, what we have scouted). Photos load as cards scroll into view, so a 60-team event
  // does not fire 60 requests at once.
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { Search } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { bestTeamPhoto, mediaImageUrl } from '$lib/matches/tbaMedia.js';
  import { filterGridRows, GRID_SORTS, sortGridRows } from '$lib/scouting/teamCharts.js';

  /** Rows from teamGridRows(). */
  export let rows = [];
  export let eventKey = '';
  export let loading = false;
  /** Builds the link for a team (kept as a real link so it can be opened in a new tab). */
  export let hrefFor = (row) => `/teamview?team=${row.number}`;

  const dispatch = createEventDispatcher();
  let query = '';
  let sortKey = 'rank';
  let photos = {};
  const requested = new Set();

  $: shown = sortGridRows(filterGridRows(rows, query), sortKey);
  $: hasRanks = rows.some((row) => row.rank != null);
  $: if (!hasRanks && sortKey === 'rank' && rows.length) sortKey = 'number';
  $: if (eventKey) {
    photos = {};
    requested.clear();
  }

  const fmt = (value, digits = 1) => (Number.isFinite(value) ? Number(value).toFixed(digits).replace(/\.0$/, '') : '—');

  async function loadPhoto(teamKey) {
    if (!eventKey || requested.has(teamKey)) return;
    requested.add(teamKey);
    try {
      const response = await fetch(
        `/api/tba/team-media?event_key=${encodeURIComponent(eventKey)}&team_key=${encodeURIComponent(teamKey)}`
      );
      const payload = await response.json().catch(() => null);
      const url = mediaImageUrl(bestTeamPhoto(payload?.success ? payload.data || [] : []));
      if (url) photos = { ...photos, [teamKey]: url };
    } catch {
      // No photo is fine; the card shows the number instead.
    }
  }

  let observer = null;
  function lazyPhoto(node, teamKey) {
    if (typeof IntersectionObserver === 'undefined') {
      void loadPhoto(teamKey);
      return {};
    }
    observer ||= new IntersectionObserver(
      (items) => {
        for (const item of items) {
          if (!item.isIntersecting) continue;
          observer.unobserve(item.target);
          void loadPhoto(item.target.dataset.team);
        }
      },
      { rootMargin: '200px' }
    );
    node.dataset.team = teamKey;
    observer.observe(node);
    return { destroy: () => observer?.unobserve(node) };
  }
  onDestroy(() => observer?.disconnect());

  function open(event, row) {
    // Plain clicks open in place; modifier clicks keep the browser's new-tab behaviour.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    dispatch('open', row);
  }
</script>

<section class="team-grid" aria-label="Teams at this event">
  <div class="toolbar">
    <label class="search">
      <Search size={16} />
      <input type="search" bind:value={query} placeholder="Team number or name" aria-label="Find a team" />
    </label>
    <label class="sort"
      >Sort
      <Select bind:value={sortKey} aria-label="Sort teams">
        {#each Object.entries(GRID_SORTS) as [key, sort]}
          {#if key !== 'rank' || hasRanks}<option value={key}>{sort.label}</option>{/if}
        {/each}
      </Select>
    </label>
    <span class="count">{shown.length} team{shown.length === 1 ? '' : 's'}</span>
  </div>

  {#if loading && !rows.length}
    <div class="cards" aria-busy="true">
      {#each Array(8) as _}<div class="card-skel"></div>{/each}
    </div>
  {:else if !rows.length}
    <p class="empty">The Blue Alliance has not posted the teams for this event yet.</p>
  {:else if !shown.length}
    <p class="empty">No team matches "{query}".</p>
  {:else}
    <ul class="cards">
      {#each shown as row (row.key)}
        <li>
          <a class="team-card" href={hrefFor(row)} on:click={(event) => open(event, row)}>
            <span class="photo" use:lazyPhoto={row.key}>
              {#if photos[row.key]}<img src={photos[row.key]} alt="" loading="lazy" />{:else}<span class="photo-num"
                  >{row.number}</span
                >{/if}
              {#if row.rank != null}<span class="rank">#{row.rank}</span>{/if}
            </span>
            <span class="body">
              <span class="title"
                ><b class="num">{row.number}</b><span class="name">{row.name || 'Team ' + row.number}</span></span
              >
              <span class="stats">
                <span><small>Record</small>{row.record || '—'}</span>
                <span><small>OPR</small>{fmt(row.opr)}</span>
                <span><small>Balls</small>{fmt(row.avgBalls)}</span>
                <span><small>Auto</small>{fmt(row.avgAuto)}</span>
              </span>
              <span class="coverage" class:low={row.coverage != null && row.coverage < 0.5}>
                {row.played
                  ? `Scouted ${row.scouted} of ${row.played} played`
                  : row.scouted
                    ? `${row.scouted} matches scouted`
                    : 'Not scouted yet'}{row.pitScouted ? ' · pit done' : ''}
              </span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .team-grid {
    display: grid;
    gap: var(--space-4);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .search {
    flex: 1 1 14rem;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.75rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text-muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    outline: none;
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .sort {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.88rem;
    color: var(--text-secondary);
  }
  .count {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: var(--space-3);
  }
  .team-card {
    display: grid;
    height: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text);
    text-decoration: none;
    overflow: hidden;
    transition:
      border-color 0.15s ease,
      transform 0.15s ease;
  }
  .team-card:hover {
    border-color: var(--accent);
  }
  .team-card:active {
    transform: scale(0.99);
  }
  .photo {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    background: var(--surface-2);
    overflow: hidden;
  }
  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .photo-num {
    font-family: var(--font-display);
    font-size: 2.4rem;
    font-weight: 700;
    color: var(--text-muted);
    opacity: 0.6;
  }
  .rank {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--background) 80%, transparent);
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 0.85rem;
  }
  .body {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .num {
    font-family: var(--font-mono);
    font-size: 1.25rem;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-1);
    font-family: var(--font-mono);
    font-size: 0.92rem;
  }
  .stats span {
    display: grid;
  }
  .stats small {
    font-family: var(--font-body);
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .coverage {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .coverage.low {
    color: var(--warning);
  }
  .card-skel {
    height: 15rem;
    border-radius: var(--radius-md);
    background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.2s ease-in-out infinite;
  }
  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card-skel {
      animation: none;
    }
  }
  .empty {
    margin: 0;
    padding: var(--space-5);
    text-align: center;
    color: var(--text-secondary);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
  }
  @media (max-width: 640px) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .body {
      padding: var(--space-2);
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .num {
      font-size: 1.1rem;
    }
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .name {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

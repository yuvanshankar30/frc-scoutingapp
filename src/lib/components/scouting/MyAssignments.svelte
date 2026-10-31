<script>
  // The signed-in scout's open assignments, shared by Home and My Reports. Each card says what kind
  // of scouting it is (from the scout's role on the People tab) and opens Match Scouting with the
  // match, robot and alliance already filled in.
  import { onMount } from 'svelte';
  import { ArrowRight, ListChecks } from 'lucide-svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import { userProfile } from '$lib/stores/auth.js';
  import { openAssignments } from '$lib/scouting/myAssignments.js';

  /** The event whose TBA schedule gives each assignment its alliance and played state. */
  export let eventKey = '';
  /** How many to show; 0 shows all of them. */
  export let limit = 0;
  /** Where "See all" points when some are left out; empty hides the link. */
  export let moreHref = '';
  /** Read by the page, e.g. for a heading count. */
  export let count = 0;
  export let loading = true;
  /** The next open assignment (or null), e.g. for a "Start next" button. */
  export let next = null;

  const TYPES = ['data', 'note', 'quick'];

  let rows = { data: [], note: [], quick: [] };
  let matches = [];
  let loadedFor = '';

  $: userId = $userProfile?.id || '';
  $: if (userId && `${userId}|${eventKey}` !== loadedFor) void load(userId, eventKey);
  $: if (!userId && $userProfile === null) loading = false;
  $: items = openAssignments([...rows.data, ...rows.note, ...rows.quick], matches);
  $: count = items.length;
  $: next = items[0] || null;
  $: shown = limit ? items.slice(0, limit) : items;
  $: hidden = items.length - shown.length;

  async function load(id, key) {
    loadedFor = `${id}|${key}`;
    loading = true;
    const headers = await getAuthHeader();
    // Cached, so the list still shows on a phone that lost the venue wifi.
    const current = (apply) => (payload) => {
      if (loadedFor === `${id}|${key}`) apply(payload);
    };
    const assignments = TYPES.map((type) =>
      fetchWithCache(`/api/scout-assignments?scouting_type=${type}&mine=1&user_id=${encodeURIComponent(id)}`, {
        cacheKey: `my-assignments:${type}:${id}`,
        headers,
        onUpdate: current((payload) => {
          if (payload?.success) rows = { ...rows, [type]: payload.data || [] };
        })
      }).catch(() => null)
    );
    const schedule = key
      ? fetchWithCache(`/api/tba/event-matches?event_key=${encodeURIComponent(key)}&comp_level=all`, {
          cacheKey: `event-matches:${key}:all`,
          onUpdate: current((payload) => {
            if (payload?.success) matches = payload.data || [];
          })
        }).catch(() => null)
      : null;
    if (!key) matches = [];
    await Promise.all([...assignments, schedule]);
    if (loadedFor === `${id}|${key}`) loading = false;
  }

  /** Re-fetch, e.g. from the page's refresh button. */
  export function refresh() {
    if (userId) void load(userId, eventKey);
  }

  onMount(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
</script>

{#if loading && !items.length}
  <div class="list" aria-busy="true" aria-label="Loading your assignments">
    <span class="sk"></span><span class="sk"></span>
  </div>
{:else if !items.length}
  <p class="empty"><ListChecks size={18} /> No assignments right now. You are caught up.</p>
{:else}
  <ul class="list">
    {#each shown as item (item.id)}
      <li>
        <a
          class="card"
          class:red={item.alliance === 'red'}
          class:blue={item.alliance === 'blue'}
          class:overdue={item.overdue}
          href={item.href}
        >
          <span class="role">{item.role}</span>
          <span class="what"
            ><b>{item.matchLabel}</b><span class="sep">·</span><b class="mono">{item.team}</b>{#if item.alliance}<span
                class="sep">·</span
              ><span class="alliance">{item.alliance}</span>{/if}</span
          >
          {#if item.overdue}<span class="flag">Played · report open</span>{/if}
          <ArrowRight size={18} />
        </a>
      </li>
    {/each}
  </ul>
  {#if hidden > 0 && moreHref}<a class="more" href={moreHref}
      >See all {items.length} assignments <ArrowRight size={14} /></a
    >{/if}
{/if}

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* Small cards side by side, so a scout with 15-20 assignments sees them all at once instead of a
       stack of full-width rows; two per row on a phone. auto-fill keeps a lone card the same size. */
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 10.5rem), 1fr));
    gap: var(--space-2);
  }
  .card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'role icon' 'what icon' 'flag icon';
    align-items: center;
    column-gap: var(--space-1);
    row-gap: 1px;
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-left: 3px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text);
    text-decoration: none;
  }
  .card:hover {
    border-color: var(--accent);
  }
  .card.red {
    border-left-color: var(--red-base);
  }
  .card.blue {
    border-left-color: var(--blue-base);
  }
  .card :global(svg) {
    grid-area: icon;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
  }
  .role {
    grid-area: role;
    font-family: var(--font-display);
    font-size: max(var(--text-min), 0.68rem);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-strong);
  }
  .what {
    grid-area: what;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.3rem;
    font-size: 0.92rem;
  }
  .what b {
    font-weight: 600;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .sep {
    color: var(--text-muted);
  }
  .alliance {
    text-transform: uppercase;
    font-size: max(var(--text-min), 0.7rem);
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .red .alliance {
    color: var(--red-strong);
  }
  .blue .alliance {
    color: var(--blue-strong);
  }
  .flag {
    grid-area: flag;
    font-size: max(var(--text-min), 0.72rem);
    color: var(--danger);
  }
  .card.overdue {
    background: color-mix(in srgb, var(--danger) 8%, var(--surface-2));
  }
  .empty {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-secondary);
    font-size: 0.92rem;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-top: var(--space-2);
    font-size: 0.88rem;
    color: var(--accent-strong);
    text-decoration: none;
  }
  .more:hover {
    text-decoration: underline;
  }
  .sk {
    display: block;
    height: 3.25rem;
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
    .sk {
      animation: none;
    }
  }
</style>

<script>
  // Search the site: every page in the menu, and the teams at the active event (each opens in Team View). Opens
  // from the box in the side menu, the search button on phones, or Ctrl+K / Cmd+K anywhere.
  import { goto } from '$app/navigation';
  import { Search, CornerDownLeft } from 'lucide-svelte';
  import Dialog from '$lib/components/common/Dialog.svelte';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import { activeEventKey } from '$lib/stores/activeEvent.js';
  import { searchSite } from '$lib/app/siteSearch.js';

  /** The pages this person can open: [{ key, label, href, blurb, group }]. */
  export let pages = [];
  export let open = false;

  let query = '';
  let active = 0;
  let input;
  let teams = [];
  let teamsFor = '';

  // The active event's teams, loaded the first time search opens for that event (cached for offline use).
  $: if (open && $activeEventKey && teamsFor !== $activeEventKey) {
    teamsFor = $activeEventKey;
    const key = $activeEventKey;
    fetchWithCache(`/api/tba/event-teams?event_key=${encodeURIComponent(key)}`, {
      cacheKey: `event-teams:${key}`,
      onUpdate: (result) => {
        if (result?.success && teamsFor === key) teams = result.data || [];
      }
    }).catch(() => {});
  }

  $: results = searchSite(query, { pages, teams });
  $: if (results) active = Math.min(active, Math.max(results.length - 1, 0));
  // After the dialog has focused its own panel, move focus into the search box.
  $: if (open && input) setTimeout(() => input?.focus(), 0);
  $: if (!open) query = '';

  function choose(result) {
    if (!result) return;
    open = false;
    goto(result.href);
  }

  function onKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(active + 1, results.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    }
  }
</script>

<svelte:window
  on:keydown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      open = !open;
    }
  }}
/>

<Dialog bind:open title="Search" width="36rem">
  <div class="ss">
    <label class="ss-box">
      <Search size={17} />
      <input
        bind:this={input}
        bind:value={query}
        on:keydown={onKey}
        on:input={() => (active = 0)}
        class="ss-input"
        type="search"
        placeholder="Pages, or a team number or name"
        aria-label="Search pages and teams"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    {#if results.length}
      <ul class="ss-results" role="listbox" aria-label="Results">
        {#each results as result, index (result.id)}
          <li role="option" aria-selected={index === active}>
            <button
              type="button"
              class="ss-result"
              class:active={index === active}
              on:mouseenter={() => (active = index)}
              on:click={() => choose(result)}
            >
              <span class="ss-kind">{result.kind}</span>
              <span class="ss-text"
                ><b>{result.label}</b>{#if result.detail}<small>{result.detail}</small>{/if}</span
              >
              {#if index === active}<CornerDownLeft size={14} />{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="ss-empty">Nothing matches "{query}".</p>
    {/if}
  </div>
</Dialog>

<style>
  .ss {
    display: grid;
    gap: var(--space-3);
  }
  .ss-box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    color: var(--text-secondary);
  }
  .ss-box:focus-within {
    border-color: var(--accent);
  }
  .ss-input {
    flex: 1;
    min-width: 0;
    min-height: 2.75rem;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }
  .ss-input:focus,
  .ss-input:focus-visible {
    outline: none;
    box-shadow: none;
    border: 0;
  }
  .ss-results {
    display: grid;
    gap: 2px;
    max-height: calc(55 * var(--vh));
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .ss-result {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 2.75rem;
    padding: 0.4rem var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ss-result.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .ss-kind {
    flex: none;
    width: 3.2rem;
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ss-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .ss-text b {
    font-weight: 500;
  }
  .ss-text small {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .ss-empty {
    margin: 0;
    color: var(--text-muted);
  }
</style>

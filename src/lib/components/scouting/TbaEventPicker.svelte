<script>
  // Optional: the TBA event a competition code tracks. Type an event's name (nicknames work) and pick from the
  // suggestions; the search runs on the server with Gemini over The Blue Alliance's event list.
  import { createEventDispatcher } from 'svelte';
  import { Check, Search, Sparkles, X } from 'lucide-svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';

  /** The competition code being set up, for the season and as context. */
  export let code = '';
  /** The chosen TBA event key, or '' for none. */
  export let value = '';
  /** A readable name for the chosen event. */
  export let label = '';
  export let disabled = false;
  export let id = 'tba-event-search';

  const dispatch = createEventDispatcher();
  let query = '';
  let suggestions = [];
  let source = '';
  let year = null;
  let searching = false;
  let error = '';
  let timer;
  let request = 0;

  function onInput() {
    clearTimeout(timer);
    error = '';
    if (query.trim().length < 2) {
      suggestions = [];
      return;
    }
    timer = setTimeout(search, 450);
  }

  async function search() {
    const current = ++request;
    searching = true;
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (code) params.set('event_key', code);
      const response = await fetch(`/api/scouting-event-link?${params}`, { headers: await getAuthHeader() });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Search failed.');
      if (current !== request) return;
      ({ suggestions, source, year } = payload.data);
    } catch (exception) {
      if (current === request) {
        error = exception.message;
        suggestions = [];
      }
    } finally {
      if (current === request) searching = false;
    }
  }

  function choose(event) {
    value = event.key;
    label = `${event.year || String(event.key).slice(0, 4)} ${event.name}`;
    query = '';
    suggestions = [];
    dispatch('change', { value, label });
  }

  function clear() {
    value = '';
    label = '';
    dispatch('change', { value, label });
  }
</script>

<div class="picker">
  {#if value}
    <div class="chosen">
      <Check size={15} />
      <span><b>{label || value}</b><small>{value}</small></span>
      <button type="button" class="clear" on:click={clear} {disabled} aria-label="Stop tracking this TBA event"
        ><X size={15} /></button
      >
    </div>
  {:else}
    <label class="search" for={id}>
      <Search size={15} />
      <input
        {id}
        type="text"
        autocomplete="off"
        placeholder="Search by event name, e.g. MadTown or Chezy"
        bind:value={query}
        on:input={onInput}
        {disabled}
      />
      {#if searching}<span class="state">Searching…</span>{/if}
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if suggestions.length}
      <ul class="suggestions" aria-label="Suggested TBA events">
        {#each suggestions as event (event.key)}
          <li>
            <button type="button" on:click={() => choose(event)} {disabled}>
              <b>{event.name}</b>
              <span
                >{event.key} · {event.city}{event.state_prov ? `, ${event.state_prov}` : ''} · {event.start_date}</span
              >
            </button>
          </li>
        {/each}
      </ul>
      <p class="hint">
        {#if source === 'gemini'}<Sparkles size={12} /> Suggested by Gemini from{:else}Matching{/if} The Blue Alliance's {year}
        events.
      </p>
    {:else if query.trim().length >= 2 && !searching && !error}
      <p class="hint">No {year || ''} TBA event matches. Add the year to search another season, e.g. "chezy 2025".</p>
    {/if}
  {/if}
</div>

<style>
  .picker {
    display: grid;
    gap: var(--space-2);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    min-height: var(--control-height, 2.5rem);
    border: 0;
    background: transparent;
    color: var(--text);
    outline: none;
  }
  .state {
    font-size: 0.75rem;
  }
  .suggestions {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .suggestions button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .suggestions button:hover,
  .suggestions button:focus-visible {
    border-color: var(--brand-gold-strong);
  }
  .suggestions span,
  .chosen small {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .chosen {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--brand-gold-strong);
    background: var(--brand-gold-soft);
  }
  .chosen :global(svg) {
    flex: none;
    color: var(--brand-gold-strong);
  }
  .chosen span {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .clear {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-muted);
    cursor: pointer;
  }
  .hint {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    margin: 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 0.8rem;
  }
</style>

<script>
  import { tick } from 'svelte';
  import { ChevronDown, Search } from 'lucide-svelte';
  import { filterTeamOptions } from '$lib/ui/teamPicker.js';

  // A team chooser that opens a small popup with its own search box, in place of a
  // browser dropdown that lists every team at once.
  export let options = []; // { value, number, name }
  export let value = '';
  export let ariaLabel = 'Team';
  export let placeholder = 'Choose a team';

  let open = false;
  let query = '';
  let active = 0;
  let root;
  let trigger;
  let input;
  let list;

  $: selected = options.find((option) => option.value === value);
  $: shown = filterTeamOptions(options, query);
  $: if (active >= shown.length) active = Math.max(0, shown.length - 1);
  $: if (open && list)
    (active, tick().then(() => list?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })));

  async function openPopup() {
    query = '';
    active = Math.max(
      0,
      options.findIndex((option) => option.value === value)
    );
    open = true;
    await tick();
    input?.focus();
  }

  function close() {
    open = false;
    trigger?.focus();
  }

  function choose(option) {
    value = option.value;
    close();
  }

  function onKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(shown.length - 1, active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, active - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') open = false;
  }
</script>

<svelte:window
  on:pointerdown={(event) => {
    if (open && root && !root.contains(event.target)) open = false;
  }}
/>

<div class="tp" bind:this={root}>
  <button
    type="button"
    class="trigger"
    bind:this={trigger}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-label={ariaLabel}
    on:click={() => (open ? close() : openPopup())}
  >
    <span class="current"
      >{#if selected}<b>#{selected.number}</b> {selected.name}{:else}{placeholder}{/if}</span
    >
    <ChevronDown size={16} aria-hidden="true" />
  </button>
  {#if open}
    <div class="pop" role="dialog" aria-label={`Choose ${ariaLabel}`}>
      <label class="find">
        <Search size={15} aria-hidden="true" />
        <input
          bind:this={input}
          bind:value={query}
          placeholder="Team number or name"
          autocomplete="off"
          on:input={() => (active = 0)}
          on:keydown={onKey}
        />
      </label>
      <ul bind:this={list}>
        {#each shown as option, index (option.value)}
          <li>
            <button
              type="button"
              tabindex="-1"
              class:active={index === active}
              class:chosen={option.value === value}
              on:mousemove={() => (active = index)}
              on:click={() => choose(option)}
            >
              <b>#{option.number}</b><span>{option.name}</span>
            </button>
          </li>
        {:else}
          <li class="none">No team matches “{query}”</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .tp {
    position: relative;
    min-width: 0;
  }
  .trigger {
    width: 100%;
    min-height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .trigger:hover {
    background: var(--surface-2);
  }
  .trigger:focus-visible,
  .trigger[aria-expanded='true'] {
    outline: none;
    border-color: var(--accent);
  }
  .current {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .current b {
    font-variant-numeric: tabular-nums;
  }
  .pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    width: max(100%, 19rem);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    box-shadow: var(--shadow-pop);
    animation: pop-in 0.12s ease-out;
  }
  @keyframes pop-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .find {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
  }
  .find input,
  .find input:focus {
    flex: 1;
    min-width: 0;
    min-height: 2.6rem;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: var(--text);
    font: inherit;
    outline: none;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: var(--space-1);
    max-height: 15rem;
    overflow-y: auto;
  }
  li button {
    width: 100%;
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    padding: 0.45rem var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  li button b {
    flex: 0 0 3.6rem;
    font-variant-numeric: tabular-nums;
  }
  li button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  li button.active {
    background: var(--surface-3);
  }
  li button.chosen b {
    color: var(--accent-strong);
  }
  .none {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .current,
    li button span {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

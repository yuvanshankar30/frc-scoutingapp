<script>
  import { onMount, tick } from 'svelte';
  import { Check, ChevronDown, Search } from 'lucide-svelte';
  import { filterSelectOptions, SEARCH_AFTER } from '$lib/ui/selectFilter.js';
  import { viewportRect, viewportSize } from '$lib/ui/zoom.js';

  // A drop-in for <select> that opens a themed popup instead of the browser's own list.
  // It is used exactly like one: <Select bind:value on:change disabled id class>, with
  // <option>s as children. A hidden native <select> inside does the binding and the change
  // events, so every existing handler keeps working; this component only draws the control.
  export let value = undefined;
  export let disabled = false;
  export let id = undefined;
  let klass = '';
  export { klass as class };
  // compact: shorter, for rows in a dense list. bare: no border or fill, for inline use inside
  // a bar. wide: fill the space it is given (defaults to on when the page styled the
  // <select> as a form field). wrap: a class for the outer box, so a page can place it in a grid.
  // wrapText: the button wraps long choices onto more lines instead of ending them in "...".
  export let compact = false;
  export let bare = false;
  export let wide = undefined;
  export let wrap = '';
  export let wrapText = false;

  let native;
  let trigger;
  let root;
  let pop;
  let input;
  let list;
  let options = [];
  let label = '';
  let isPlaceholder = false;
  let current = -1;
  let open = false;
  let query = '';
  let active = 0;
  let placement = '';

  // Same look as a form field when the page styled the <select> as one, otherwise as wide
  // as its text.
  $: fill = wide ?? /form-select|form-input|sp-input/.test(klass);
  // A placeholder row ("Choose a team...") is shown on the button, not offered as a choice.
  $: choices = options.filter((option) => !(option.disabled && option.value === ''));
  $: searchable = choices.length > SEARCH_AFTER;
  $: shown = searchable ? filterSelectOptions(choices, query) : choices;
  $: if (active >= shown.length) active = Math.max(0, shown.length - 1);
  $: if (open && list)
    (active, tick().then(() => list?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })));
  $: if (native) {
    value;
    tick().then(read);
  }

  function read() {
    if (!native) return;
    // Options built by a loop can arrive after the value was applied, leaving nothing
    // selected; apply the current value again once they are there. Svelte keeps the real
    // (possibly numeric) value on each option as __value.
    if (native.selectedIndex === -1 && value !== undefined && value !== null) {
      const found = [...native.options].findIndex((option) => String(option.__value ?? option.value) === String(value));
      if (found >= 0) native.selectedIndex = found;
    }
    options = [...native.options].map((option, index) => ({
      index,
      value: option.value,
      label: option.text.trim(),
      disabled: option.disabled
    }));
    // A value that is null or undefined means "nothing chosen": show the option meant for
    // that (the one with an empty value) instead of a blank box.
    current = native.selectedIndex;
    if (current === -1 && (value === null || value === undefined))
      current = options.findIndex((option) => option.value === '');
    const selected = options[current];
    label = selected ? selected.label : '';
    isPlaceholder = !selected || selected.value === '';
  }

  onMount(() => {
    read();
    const watcher = new MutationObserver(read);
    watcher.observe(native, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'label', 'value']
    });
    return () => watcher.disconnect();
  });

  async function openPopup() {
    if (disabled) return;
    read();
    query = '';
    active = Math.max(
      0,
      choices.findIndex((option) => option.index === current)
    );
    // Fixed position, so a table or card with overflow hidden cannot clip the list.
    // The list can be wider than the button (up to 32rem) so long choices wrap less.
    const rect = viewportRect(trigger);
    const width = Math.max(rect.width, 208);
    const maxWidth = Math.max(width, Math.min(512, viewportSize().width - 16));
    const left = Math.max(8, Math.min(rect.left, viewportSize().width - maxWidth - 8));
    const below = viewportSize().height - rect.bottom - 12;
    const above = rect.top - 12;
    const flip = below < 230 && above > below;
    const room = Math.max(160, Math.min(360, flip ? above : below));
    placement =
      `left:${left}px;min-width:${width}px;max-width:${maxWidth}px;max-height:${room}px;` +
      (flip ? `bottom:${viewportSize().height - rect.top + 4}px;` : `top:${rect.bottom + 4}px;`);
    open = true;
    await tick();
    (searchable ? input : list)?.focus();
  }

  function close(refocus = true) {
    open = false;
    if (refocus) trigger?.focus();
  }

  function choose(option) {
    native.selectedIndex = option.index;
    native.dispatchEvent(new Event('input', { bubbles: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
    read();
    close();
  }

  function onKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(shown.length - 1, active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, active - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      active = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      active = Math.max(0, shown.length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close(false);
  }

  function onTriggerKey(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openPopup();
    }
  }

  function dismissOutside(event) {
    if (open && root && !root.contains(event.target) && !pop?.contains(event.target)) open = false;
  }

  // Scrolling the page would leave a fixed popup behind, so close it; scrolling inside the
  // popup's own list is fine.
  function dismissOnScroll(event) {
    if (open && !pop?.contains(event.target)) open = false;
  }
</script>

<svelte:window on:pointerdown={dismissOutside} on:scroll|capture={dismissOnScroll} on:resize={() => (open = false)} />

<div class="select {wrap}" class:fill bind:this={root}>
  <button
    type="button"
    class="trigger"
    class:compact
    class:bare
    class:wrap-text={wrapText}
    {id}
    {disabled}
    bind:this={trigger}
    aria-haspopup="listbox"
    aria-expanded={open}
    {...$$restProps}
    on:click={() => (open ? close() : openPopup())}
    on:keydown={onTriggerKey}
  >
    <span class="current" class:dim={isPlaceholder}>{label || ' '}</span>
    <ChevronDown size={16} aria-hidden="true" />
  </button>
  <select bind:this={native} bind:value {disabled} class="native" tabindex="-1" aria-hidden="true" on:change on:input>
    <slot />
  </select>
  {#if open}
    <div class="pop" bind:this={pop} style={placement}>
      {#if searchable}
        <label class="find">
          <Search size={15} aria-hidden="true" />
          <input
            bind:this={input}
            bind:value={query}
            placeholder="Search"
            autocomplete="off"
            on:input={() => (active = 0)}
            on:keydown={onKey}
          />
        </label>
      {/if}
      <ul
        bind:this={list}
        role="listbox"
        tabindex="-1"
        aria-label={$$restProps['aria-label'] || 'Options'}
        on:keydown={onKey}
      >
        {#each shown as option, index (option.index)}
          <li>
            <button
              type="button"
              tabindex="-1"
              disabled={option.disabled}
              class:active={index === active}
              class:chosen={option.index === current}
              on:mousemove={() => (active = index)}
              on:click={() => choose(option)}
            >
              <span>{option.label || ' '}</span>
              {#if option.index === current}<Check size={14} aria-hidden="true" />{/if}
            </button>
          </li>
        {:else}
          <li class="none">No match for “{query}”</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .select {
    position: relative;
    display: inline-block;
    min-width: 0;
    max-width: 100%;
    vertical-align: middle;
  }
  .select.fill {
    display: block;
  }
  /* The real <select> stays in the page, unseen, so binding, change events and forms work. */
  .native {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
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
  .trigger.compact {
    min-height: 2.3rem;
    padding: 0 var(--space-2);
    font-size: 0.9rem;
  }
  .trigger.bare {
    min-height: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
  }
  .trigger.bare:hover:not(:disabled) {
    background: none;
  }
  .trigger.bare:focus-visible,
  .trigger.bare[aria-expanded='true'] {
    color: var(--accent-strong);
  }
  .trigger:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .trigger:focus-visible,
  .trigger[aria-expanded='true'] {
    outline: none;
    border-color: var(--accent);
  }
  .trigger:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .current {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trigger.wrap-text {
    height: auto;
    min-height: var(--control-height);
    text-align: left;
  }
  .trigger.wrap-text .current {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    overflow-wrap: anywhere;
  }
  .current.dim {
    color: var(--text-muted);
  }
  .pop {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    box-shadow: var(--shadow-pop);
    animation: select-in 0.12s ease-out;
    overflow: hidden;
  }
  @keyframes select-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .find {
    flex: 0 0 auto;
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
    overflow-y: auto;
    outline: none;
  }
  li button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 0.45rem var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  /* List items wrap instead of ending in "...": the list has room to grow, so no choice is hidden. */
  li button span {
    min-width: 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  li button:disabled {
    color: var(--text-muted);
    cursor: not-allowed;
  }
  li button.active {
    background: var(--surface-3);
  }
  li button.chosen {
    color: var(--accent-strong);
  }
  .none {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .current {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

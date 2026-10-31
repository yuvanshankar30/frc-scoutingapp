<script>
  import { ChevronLeft, ChevronRight, Calendar } from 'lucide-svelte';
  import { viewportRect, viewportSize } from '$lib/ui/zoom.js';

  // A day chooser with the site's own popup calendar, in place of the browser's date input.
  // `value` is an ISO day ("2026-09-20") or '' for none, like <input type="date">.
  export let value = '';
  export let id = undefined;
  export let disabled = false;
  export let placeholder = 'Pick a day';

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];
  const iso = (year, month, day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parse = (text) => {
    const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
    return found ? { year: +found[1], month: +found[2] - 1, day: +found[3] } : null;
  };

  let open = false;
  let root;
  let trigger;
  let placement = '';
  let year = new Date().getFullYear();
  let month = new Date().getMonth();

  $: chosen = parse(value);
  $: label = chosen
    ? new Date(chosen.year, chosen.month, chosen.day).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    : '';
  $: firstWeekday = new Date(year, month, 1).getDay();
  $: daysInMonth = new Date(year, month + 1, 0).getDate();
  $: cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  $: today = iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  function openPopup() {
    if (disabled) return;
    const start = chosen || parse(today);
    year = start.year;
    month = start.month;
    const rect = viewportRect(trigger);
    const width = 288;
    const left = Math.max(8, Math.min(rect.left, viewportSize().width - width - 8));
    const flip = viewportSize().height - rect.bottom < 330 && rect.top > viewportSize().height - rect.bottom;
    placement =
      `left:${left}px;width:${width}px;` +
      (flip ? `bottom:${viewportSize().height - rect.top + 4}px;` : `top:${rect.bottom + 4}px;`);
    open = true;
  }

  function close() {
    open = false;
    trigger?.focus();
  }

  function pick(day) {
    value = iso(year, month, day);
    close();
  }

  function step(delta) {
    const next = new Date(year, month + delta, 1);
    year = next.getFullYear();
    month = next.getMonth();
  }

  function goToday() {
    const now = parse(today);
    value = today;
    year = now.year;
    month = now.month;
    close();
  }
</script>

<svelte:window
  on:pointerdown={(event) => {
    if (open && root && !root.contains(event.target)) open = false;
  }}
  on:scroll|capture={(event) => {
    if (open && !root?.contains(event.target)) open = false;
  }}
  on:resize={() => (open = false)}
  on:keydown={(event) => {
    if (open && event.key === 'Escape') close();
  }}
/>

<div class="date" bind:this={root}>
  <button
    type="button"
    class="trigger"
    {id}
    {disabled}
    bind:this={trigger}
    aria-haspopup="dialog"
    aria-expanded={open}
    on:click={() => (open ? close() : openPopup())}
  >
    <span class:dim={!label}>{label || placeholder}</span>
    <Calendar size={16} aria-hidden="true" />
  </button>
  {#if open}
    <div class="pop" style={placement} role="dialog" aria-label="Choose a day">
      <div class="head">
        <button type="button" class="nav" aria-label="Previous month" on:click={() => step(-1)}
          ><ChevronLeft size={16} /></button
        >
        <b>{MONTHS[month]} {year}</b>
        <button type="button" class="nav" aria-label="Next month" on:click={() => step(1)}
          ><ChevronRight size={16} /></button
        >
      </div>
      <div class="grid weekdays" aria-hidden="true">
        {#each ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as day}<span>{day}</span>{/each}
      </div>
      <div class="grid">
        {#each cells as day}
          {#if day === null}<span></span>
          {:else}
            <button
              type="button"
              class="day"
              class:chosen={value === iso(year, month, day)}
              class:today={today === iso(year, month, day)}
              on:click={() => pick(day)}>{day}</button
            >
          {/if}
        {/each}
      </div>
      <button type="button" class="today-btn" on:click={goToday}>Today</button>
    </div>
  {/if}
</div>

<style>
  .date {
    position: relative;
    display: inline-block;
    max-width: 100%;
    vertical-align: middle;
  }
  .trigger {
    min-width: 11rem;
    min-height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .trigger:hover:not(:disabled) {
    background: var(--surface-3);
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
  .dim {
    color: var(--text-muted);
  }
  .pop {
    position: fixed;
    z-index: 1000;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    box-shadow: var(--shadow-pop);
    animation: date-in 0.12s ease-out;
  }
  @keyframes date-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2);
  }
  .nav {
    min-width: 0;
    min-height: 0;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .nav:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
  }
  .weekdays {
    margin-bottom: 2px;
    color: var(--text-muted);
    font-size: 0.72rem;
    text-align: center;
  }
  .day {
    min-width: 0;
    min-height: 0;
    height: 2.2rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .day:hover {
    background: var(--surface-3);
  }
  .day.today {
    color: var(--accent-strong);
    font-weight: 650;
  }
  .day.chosen {
    background: var(--accent);
    color: var(--accent-contrast, #111);
    font-weight: 650;
  }
  .today-btn {
    width: 100%;
    margin-top: var(--space-2);
    padding: 0.4rem;
    border: 0;
    border-top: 1px solid var(--border);
    background: transparent;
    color: var(--accent-strong);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
</style>

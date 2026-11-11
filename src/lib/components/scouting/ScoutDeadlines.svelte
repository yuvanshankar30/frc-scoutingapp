<script>
  import { onMount } from 'svelte';
  import { Check, Pencil } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import DatePicker from '$lib/components/common/DatePicker.svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { canonicalReports } from '$lib/matches/matchKeys.js';
  import {
    atClock,
    buildMatchRows,
    clockOf,
    dayOf,
    deadlinesForRange,
    dueText,
    owedByScout,
    summarize,
    teamNumber
  } from '$lib/scouting/scoutDeadlines.js';

  export let eventKey = '';
  // Reports already loaded by Scouting Admin, so a submitted report clears its slot at once.
  export let matchReports = [];

  const PAGE = 40;

  let matches = [];
  let assignments = [];
  let deadlines = new Map();
  let loading = false;
  let error = '';
  let canEdit = false;
  let now = new Date();

  let view = 'matches';
  let filter = 'all';
  let query = '';
  let limit = PAGE;
  let editingKey = '';
  let editDay = '';
  let editClock = '';
  let saving = false;
  let message = '';
  let messageIsError = false;

  // Bulk tool
  let from = 1;
  let to = 1;
  let mode = 'after';
  let offsetMinutes = 30;
  let bulkDay = dayOf(new Date());
  let bulkClock = '6:00 PM';

  $: rows = buildMatchRows({ matches, assignments, reports: canonicalReports(matchReports, eventKey), deadlines, now });
  $: stats = summarize(rows);
  $: owed = owedByScout(rows);
  $: lastMatch = rows.length ? rows[rows.length - 1].number : 1;
  $: if (rows.length && to === 1 && from === 1) to = Math.min(10, lastMatch);

  $: filtered = rows.filter((row) => {
    if (filter === 'late' && !row.counts.late) return false;
    if (filter === 'missed' && !row.counts.missed) return false;
    if (filter === 'open' && !(row.dueAt && row.state !== 'done' && row.state !== 'late')) return false;
    if (filter === 'none' && row.dueAt) return false;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text =
      `${row.number} qm${row.number} ${row.slots.map((slot) => `${teamNumber(slot.teamKey)} ${slot.scoutName || ''}`).join(' ')}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });

  const FILTERS = [
    { value: 'all', label: 'All matches' },
    { value: 'late', label: 'Late' },
    { value: 'missed', label: 'Missed' },
    { value: 'open', label: 'Deadline ahead' },
    { value: 'none', label: 'No deadline set' }
  ];
  const MODES = [
    { value: 'after', label: 'After the match is scheduled' },
    { value: 'at', label: 'At one set time' }
  ];

  let loadedFor = '';
  // The event arrives after this mounts (Scouting Admin loads it), so load whenever it changes.
  $: if (eventKey && eventKey !== loadedFor) {
    loadedFor = eventKey;
    load();
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const headers = await getAuthHeader();
      const [matchRes, assignRes, deadlineRes] = await Promise.all([
        fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(eventKey)}&comp_level=qm`),
        fetch('/api/scout-assignments?scouting_type=data', { headers }),
        fetch(`/api/scouting-deadlines?event_key=${encodeURIComponent(eventKey)}`, { headers })
      ]);
      const [matchData, assignData, deadlineData] = await Promise.all(
        [matchRes, assignRes, deadlineRes].map((res) => res.json().catch(() => null))
      );
      if (!matchData?.success) throw new Error(matchData?.error || 'Could not load the match schedule.');
      if (!deadlineRes.ok) throw new Error(deadlineData?.error || 'Could not load deadlines.');
      matches = matchData.data || [];
      assignments = assignData?.success ? assignData.data || [] : [];
      deadlines = new Map((deadlineData.data || []).map((row) => [row.match_key, row.due_at]));
      canEdit = deadlineData.can_edit === true;
      if (deadlineData.now) now = new Date(deadlineData.now);
    } catch (cause) {
      error = cause.message || 'Could not load deadlines.';
    } finally {
      loading = false;
    }
  }

  async function save(items) {
    saving = true;
    message = '';
    try {
      const res = await fetch('/api/scouting-deadlines', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({ event_key: eventKey, deadlines: items })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Could not save (${res.status})`);
      const next = new Map(deadlines);
      for (const item of items)
        item.due_at === null ? next.delete(item.match_key) : next.set(item.match_key, item.due_at);
      deadlines = next;
      return true;
    } catch (cause) {
      message = cause.message;
      messageIsError = true;
      return false;
    } finally {
      saving = false;
    }
  }

  async function applyRange(clear = false) {
    const at = mode === 'at' ? atClock(bulkDay, bulkClock) : null;
    if (!clear && mode === 'at' && !at) {
      message = 'Enter a time like 6:30 PM.';
      messageIsError = true;
      return;
    }
    const { items, skipped } = clear
      ? {
          items: rows
            .filter((row) => row.number >= Math.min(from, to) && row.number <= Math.max(from, to))
            .map((row) => ({ match_key: row.key, due_at: null })),
          skipped: 0
        }
      : deadlinesForRange(rows, { from, to, mode, offsetMinutes: Number(offsetMinutes) || 0, at });
    if (!items.length) {
      message = 'No matches in that range to change.';
      messageIsError = true;
      return;
    }
    if (await save(items)) {
      message = clear
        ? `Removed the deadline from ${items.length} match${items.length === 1 ? '' : 'es'}.`
        : `Set a deadline for ${items.length} match${items.length === 1 ? '' : 'es'}${skipped ? `; ${skipped} had no scheduled time` : ''}.`;
      messageIsError = false;
    }
  }

  function openEditor(row) {
    if (editingKey === row.key) {
      editingKey = '';
      return;
    }
    const start = row.dueAt || row.scheduledAt || new Date();
    editingKey = row.key;
    editDay = dayOf(start);
    editClock = clockOf(start);
  }

  async function saveOne(row, remove = false) {
    const due = remove ? null : atClock(editDay, editClock);
    if (!remove && !due) {
      message = 'Enter a day and a time like 6:30 PM.';
      messageIsError = true;
      return;
    }
    if (await save([{ match_key: row.key, due_at: due ? due.toISOString() : null }])) {
      editingKey = '';
      message = '';
    }
  }

  async function copyOwed() {
    const text = owed
      .map(
        (scout) =>
          `${scout.name}: ${scout.items.map((item) => `${item.match} (${teamNumber(item.teamKey)})`).join(', ')}`
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      message = 'Copied the list.';
      messageIsError = false;
    } catch {
      message = 'Could not copy.';
      messageIsError = true;
    }
  }

  const first = (name) => String(name || '').split(' ')[0];
  const STATUS_WORD = { late: 'late', missed: 'missed' };
  function relative(due) {
    const minutes = Math.round((due.getTime() - now.getTime()) / 60000);
    const span = Math.abs(minutes) >= 90 ? `${Math.round(Math.abs(minutes) / 60)} h` : `${Math.abs(minutes)} min`;
    return minutes >= 0 ? `in ${span}` : `${span} ago`;
  }

  onMount(() => {
    const tick = setInterval(() => (now = new Date()), 30000);
    return () => clearInterval(tick);
  });
</script>

<div class="deadlines">
  {#if !eventKey}
    <p class="empty">Set the event in Event setup first; deadlines are per match of the current event.</p>
  {:else if loading}
    <p class="muted">Loading the schedule…</p>
  {:else if error}
    <p class="empty bad">{error}</p>
  {:else}
    <p class="summary">
      {stats.matches} matches · {stats.withDeadline} with a deadline ·
      <button
        type="button"
        class="link"
        class:bad={stats.late}
        on:click={() => {
          view = 'matches';
          filter = 'late';
          limit = PAGE;
        }}>{stats.late} late</button
      >
      ·
      <button
        type="button"
        class="link"
        class:warn={stats.missed}
        on:click={() => {
          view = 'matches';
          filter = 'missed';
          limit = PAGE;
        }}>{stats.missed} missed</button
      >
      ·
      {stats.done} fully scouted
    </p>

    {#if canEdit}
      <section class="tool">
        <h3>Set deadlines</h3>
        <p class="hint">
          Pick a run of matches and when their reports are due. Change a single match from its row below.
        </p>
        <div class="tool-row">
          <label class="num">From QM<input type="number" min="1" max={lastMatch} bind:value={from} /></label>
          <label class="num">to QM<input type="number" min="1" max={lastMatch} bind:value={to} /></label>
          <label class="grow"
            >Due
            <Select class="form-select" bind:value={mode}
              >{#each MODES as option}<option value={option.value}>{option.label}</option>{/each}</Select
            >
          </label>
          {#if mode === 'after'}
            <label class="num wide"
              >Minutes after start<input type="number" min="0" step="5" bind:value={offsetMinutes} /></label
            >
          {:else}
            <div class="when"><span class="cap">Day</span><DatePicker bind:value={bulkDay} /></div>
            <label class="num wide">Time<input type="text" bind:value={bulkClock} placeholder="6:30 PM" /></label>
          {/if}
          <button type="button" class="btn btn-primary" disabled={saving} on:click={() => applyRange(false)}
            >{saving ? 'Saving…' : 'Apply'}</button
          >
          <button type="button" class="btn btn-outline" disabled={saving} on:click={() => applyRange(true)}
            >Remove in range</button
          >
        </div>
        {#if message}<p class="note" class:bad={messageIsError}>{message}</p>{/if}
      </section>
    {:else}
      <p class="hint">You can see the deadlines here. Scouting Admins set them.</p>
    {/if}

    <div class="tabs" role="tablist">
      <button
        type="button"
        class="tab"
        class:active={view === 'matches'}
        role="tab"
        aria-selected={view === 'matches'}
        on:click={() => (view = 'matches')}>Matches</button
      >
      <button
        type="button"
        class="tab"
        class:active={view === 'owed'}
        role="tab"
        aria-selected={view === 'owed'}
        on:click={() => (view = 'owed')}
      >
        Reports owed{#if owed.length}<span class="count"
            >{owed.reduce((sum, scout) => sum + scout.items.length, 0)}</span
          >{/if}
      </button>
    </div>

    {#if view === 'matches'}
      <div class="controls">
        <input
          class="search"
          type="search"
          placeholder="Match, team or scout"
          aria-label="Search matches"
          bind:value={query}
          on:input={() => (limit = PAGE)}
        />
        <label class="field"
          >Show
          <Select bind:value={filter} on:change={() => (limit = PAGE)}
            >{#each FILTERS as option}<option value={option.value}>{option.label}</option>{/each}</Select
          >
        </label>
      </div>

      {#if !filtered.length}
        <p class="empty">No matches here.</p>
      {:else}
        <div class="table">
          <div class="head">
            <span>Match</span><span class="red-h">Red alliance</span><span class="blue-h">Blue alliance</span><span
              >Deadline</span
            >
          </div>
          {#each filtered.slice(0, limit) as row (row.key)}
            <div class="group" class:late={row.state === 'late'} class:open={editingKey === row.key}>
              <div class="row">
                <div class="match">
                  <b>{row.label}</b>
                  {#if row.scheduledAt}<small>{clockOf(row.scheduledAt)}</small>{/if}
                </div>
                {#each ['red', 'blue'] as side}
                  <ul class="alliance {side}">
                    {#each row.slots.filter((slot) => slot.alliance === side) as slot (slot.teamKey)}
                      <li class={slot.status} class:noscout={!slot.hasScout}>
                        <b>{teamNumber(slot.teamKey)}</b>
                        <span class="who">{slot.hasScout ? first(slot.scoutName) : 'No Scout'}</span>
                        {#if slot.status === 'done'}<span class="mark"><Check size={13} aria-label="Reported" /></span>
                        {:else if STATUS_WORD[slot.status]}<span class="word">{STATUS_WORD[slot.status]}</span>{/if}
                      </li>
                    {/each}
                  </ul>
                {/each}
                <div class="due">
                  {#if row.dueAt}
                    <b>{dueText(row.dueAt)}</b>
                    <small class:bad={row.counts.late}>{row.state === 'done' ? 'all in' : relative(row.dueAt)}</small>
                  {:else}<span class="muted">No deadline</span>{/if}
                  {#if canEdit}<button
                      type="button"
                      class="edit"
                      aria-label={`Edit the deadline for ${row.label}`}
                      aria-expanded={editingKey === row.key}
                      on:click={() => openEditor(row)}><Pencil size={14} /></button
                    >{/if}
                </div>
              </div>
              {#if editingKey === row.key}
                <div class="editor">
                  <span class="cap">{row.label} reports are due</span>
                  <DatePicker bind:value={editDay} />
                  <input
                    type="text"
                    class="time"
                    bind:value={editClock}
                    placeholder="6:30 PM"
                    aria-label="Time"
                    on:keydown={(event) => event.key === 'Enter' && saveOne(row)}
                  />
                  <button type="button" class="btn btn-primary" disabled={saving} on:click={() => saveOne(row)}
                    >Save</button
                  >
                  {#if row.dueAt}<button
                      type="button"
                      class="btn btn-outline"
                      disabled={saving}
                      on:click={() => saveOne(row, true)}>Remove</button
                    >{/if}
                  <button type="button" class="btn btn-outline" on:click={() => (editingKey = '')}>Cancel</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
        {#if filtered.length > limit}<button type="button" class="more" on:click={() => (limit += PAGE)}
            >Show {Math.min(PAGE, filtered.length - limit)} more matches</button
          >{/if}
      {/if}
    {:else if !owed.length}
      <p class="empty">Nobody owes a report. Late and missed reports show up here, grouped by scout.</p>
    {:else}
      <div class="owed-head">
        <p class="hint">Reports whose deadline has passed, or that a scout skipped to scout a later match.</p>
        <button type="button" class="btn btn-outline" on:click={copyOwed}>Copy list</button>
      </div>
      {#if message}<p class="note" class:bad={messageIsError}>{message}</p>{/if}
      <ul class="owed">
        {#each owed as scout (scout.id || scout.name)}
          <li>
            <h4>{scout.name}<span>{scout.items.length} owed</span></h4>
            <div class="items">
              {#each scout.items as item}
                <div class="item {item.status}">
                  <b>{item.match}</b><span>Team {teamNumber(item.teamKey)}</span><em>{item.status}</em
                  >{#if item.dueAt}<small>due {dueText(item.dueAt)}</small>{/if}
                </div>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .deadlines {
    display: grid;
    gap: var(--space-4);
  }
  .summary {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    min-width: 0;
    min-height: 0;
  }
  .link.bad,
  .bad {
    color: var(--danger);
  }
  .link.warn,
  .warn {
    color: var(--warning);
  }
  .hint,
  .muted {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .empty {
    margin: 0;
    padding: var(--space-6);
    text-align: center;
    color: var(--text-muted);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
  }
  .empty.bad {
    color: var(--danger);
  }
  .note {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .note.bad {
    color: var(--danger);
  }

  .tool {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .tool h3 {
    margin: 0;
    font-size: 1rem;
  }
  .tool-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-3);
  }
  .tool-row label,
  .when {
    display: grid;
    gap: var(--space-1);
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .cap {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .tool-row .grow {
    min-width: 16rem;
  }
  .num input,
  .time,
  .search {
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }
  .num {
    width: 6.5rem;
  }
  .num.wide {
    width: 9rem;
  }
  .num input:focus,
  .time:focus,
  .search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .tool-row .btn {
    min-height: 2.5rem;
  }

  .tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border);
  }
  .tab {
    min-width: 0;
    min-height: 0;
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    color: var(--accent-strong);
    border-bottom-color: var(--accent);
  }
  .count {
    margin-left: 0.4rem;
    color: var(--danger);
    font-variant-numeric: tabular-nums;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
  }
  .search {
    flex: 0 1 18rem;
    font-size: 0.9rem;
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  .table {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .head,
  .row {
    display: grid;
    grid-template-columns: 5rem minmax(11rem, 1fr) minmax(11rem, 1fr) 12.5rem;
    column-gap: var(--space-6);
    row-gap: var(--space-3);
    align-items: center;
    padding: 0 var(--space-4);
  }
  .head {
    height: 2.4rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .group {
    border-bottom: 1px solid var(--border);
  }
  .group:last-child {
    border-bottom: 0;
  }
  .group.late {
    box-shadow: inset 3px 0 var(--danger);
  }
  .group.open {
    background: var(--surface-2);
  }
  .row {
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
  }
  .match b {
    display: block;
    font-size: 1rem;
  }
  .match small,
  .due small {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .alliance {
    list-style: none;
    margin: 0;
    padding: 0 0 0 var(--space-3);
    display: grid;
    gap: 2px;
    border-left: 3px solid var(--border);
  }
  .alliance.red {
    border-left-color: var(--alliance-red);
  }
  .alliance.blue {
    border-left-color: var(--alliance-blue);
  }
  .alliance li {
    display: grid;
    grid-template-columns: 3.2rem minmax(0, max-content) auto;
    justify-content: start;
    gap: var(--space-2);
    align-items: baseline;
    font-size: 0.86rem;
  }
  .alliance li b {
    font-variant-numeric: tabular-nums;
  }
  .alliance .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .alliance .word {
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .alliance li.late .word,
  .alliance li.late .who {
    color: var(--danger);
  }
  .alliance li.missed .word,
  .alliance li.missed .who {
    color: var(--warning);
  }
  .alliance li.noscout b {
    color: var(--text-muted);
    font-weight: 500;
  }
  .alliance li.noscout .who {
    color: var(--text-muted);
    font-style: italic;
  }
  .alliance .mark {
    color: var(--text-muted);
    display: inline-flex;
  }
  .due {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
  }
  .due b {
    grid-column: 1;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .due small {
    grid-column: 1;
  }
  .due .muted {
    grid-column: 1;
  }
  .edit {
    grid-column: 2;
    grid-row: 1 / span 2;
    min-width: 0;
    min-height: 0;
    display: grid;
    place-items: center;
    width: 2.2rem;
    height: 2.2rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .edit:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .editor {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--border);
  }
  .editor .time {
    width: 8rem;
  }
  .editor .btn {
    min-height: 2.5rem;
  }
  .more {
    justify-self: start;
    min-width: 0;
    min-height: 0;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .more:hover {
    background: var(--surface-2);
  }

  .owed-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .owed {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-3);
  }
  .owed li {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .owed h4 {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    font-size: 0.95rem;
  }
  .owed h4 span {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-weight: 400;
  }
  .item {
    display: grid;
    grid-template-columns: 4.5rem 7rem 5rem 1fr;
    gap: var(--space-3);
    align-items: baseline;
    padding: 0.5rem var(--space-4);
    border-bottom: 1px solid var(--border);
    font-size: 0.86rem;
  }
  .item:last-child {
    border-bottom: 0;
  }
  .item em {
    font-style: normal;
    font-size: 0.78rem;
  }
  .item.late em {
    color: var(--danger);
  }
  .item.missed em {
    color: var(--warning);
  }
  .item small {
    color: var(--text-muted);
    text-align: right;
  }

  @media (max-width: 900px) {
    .head {
      display: none;
    }
    .row {
      grid-template-columns: 1fr 1fr;
      row-gap: var(--space-3);
      padding: var(--space-3);
    }
    .match,
    .due {
      grid-column: 1 / -1;
    }
    .match {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
    }
    .item {
      grid-template-columns: 4rem 1fr auto;
    }
    .item small {
      display: none;
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .alliance .who {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

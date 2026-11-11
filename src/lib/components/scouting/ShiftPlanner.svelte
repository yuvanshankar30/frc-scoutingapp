<script>
  // Scouting Admin > Assignments > Shifts. Each field slot (Red 1 ... Blue 3) is a lane of shifts: one scout scouts
  // every robot in that slot from one match to another, then the next scout takes over. Save keeps the plan; Publish
  // also turns it into the per-match assignments scouts see on Home. Logic: src/lib/scouting/shiftPlan.js.
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { Plus, Sparkles, Trash2, Wand2 } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scouting/scoutingEvent.js';
  import { requestConfirmation } from '$lib/app/confirmation.js';
  import { SLOTS, assignmentsFromShifts, autoPlan, qualRange, validateShifts } from '$lib/scouting/shiftPlan.js';

  let eventKey = '';
  let schedule = [];
  let scouts = [];
  let shifts = [];
  let canEdit = false;
  let loading = true;
  let saving = false;
  let error = '';
  let notice = '';
  let notes = [];

  let showAuto = false;
  let autoLength = 8;
  let autoScouts = [];

  let nextId = 0;
  const newId = () => `new-${(nextId += 1)}`;

  async function load() {
    loading = true;
    error = '';
    try {
      eventKey = (await fetchActiveScoutingEventKey()) || '';
      if (!eventKey) throw new Error('Set the active event in Event setup first.');
      const [matchesRes, scoutsRes, shiftsRes] = await Promise.all([
        fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(eventKey)}&comp_level=qm`).then((r) => r.json()),
        authFetch('/api/scout-assignments?eligible=1&scouting_type=data').then((r) => r.json()),
        authFetch(`/api/scout-shifts?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json())
      ]);
      schedule = matchesRes?.success ? matchesRes.data || [] : [];
      scouts = scoutsRes?.success ? scoutsRes.data || [] : [];
      if (shiftsRes?.error) throw new Error(shiftsRes.error);
      shifts = (shiftsRes.shifts || []).map((shift) => ({ ...shift, id: shift.id || newId() }));
      canEdit = Boolean(shiftsRes.canEdit);
      if (!autoScouts.length) autoScouts = scouts.slice(0, 12).map((scout) => scout.id);
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  $: range = qualRange(schedule) || { first: 1, last: 80 };
  $: names = new Map(scouts.map((scout) => [scout.id, scout.full_name || scout.email || 'Scout']));
  $: problems = validateShifts(shifts, { firstMatch: range.first, lastMatch: range.last, names });
  $: lanes = SLOTS.map((slot) => ({
    ...slot,
    shifts: shifts.filter((shift) => shift.slot === slot.key).sort((a, b) => (a.start ?? 0) - (b.start ?? 0))
  }));
  $: totalMatches = Math.max(1, range.last - range.first + 1);
  $: coverage = Object.fromEntries(
    SLOTS.map((slot) => [
      slot.key,
      shifts
        .filter((s) => s.slot === slot.key && s.start != null && s.end != null)
        .reduce((sum, s) => sum + Math.max(0, Math.min(s.end, range.last) - Math.max(s.start, range.first) + 1), 0)
    ])
  );
  // Where each shift sits on its lane, as a share of the qualification schedule.
  const clampStart = (shift) => Math.max(shift.start ?? range.first, range.first);
  const left = (shift) => `${((clampStart(shift) - range.first) / totalMatches) * 100}%`;
  const width = (shift) =>
    `${(Math.max(0, Math.min(shift.end ?? range.first, range.last) - clampStart(shift) + 1) / totalMatches) * 100}%`;

  function addShift(slotKey) {
    const after = shifts
      .filter((s) => s.slot === slotKey)
      .reduce((max, s) => Math.max(max, s.end ?? 0), range.first - 1);
    const start = Math.min(after + 1, range.last);
    shifts = [
      ...shifts,
      { id: newId(), slot: slotKey, start, end: Math.min(start + autoLength - 1, range.last), userId: null }
    ];
  }

  const update = (id, patch) => (shifts = shifts.map((shift) => (shift.id === id ? { ...shift, ...patch } : shift)));
  const remove = (id) => (shifts = shifts.filter((shift) => shift.id !== id));

  async function runAuto() {
    if (
      shifts.length &&
      !(await requestConfirmation({
        title: 'Replace the plan',
        message: 'Auto-plan replaces every shift on the board. Nothing is saved until you save or publish.',
        confirmLabel: 'Replace'
      }))
    )
      return;
    const result = autoPlan({ scouts: autoScouts, length: autoLength, firstMatch: range.first, lastMatch: range.last });
    shifts = result.shifts.map((shift) => ({ ...shift, id: newId() }));
    notes = result.notes;
    showAuto = false;
  }

  async function post(url, body) {
    const response = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save.');
    return result;
  }

  async function save({ publish = false } = {}) {
    if (problems.length) return;
    saving = true;
    error = '';
    notice = '';
    try {
      const saved = await post('/api/scout-shifts', { event_key: eventKey, shifts });
      if (!publish) {
        notice = `Saved ${saved.saved} shift${saved.saved === 1 ? '' : 's'}.`;
        return;
      }
      const { items, missing } = assignmentsFromShifts(shifts, schedule);
      if (!items.length) throw new Error('No match in these shifts is on the schedule yet.');
      await post('/api/scout-assignments', { action: 'bulk-assign', scouting_type: 'data', items });
      notice = `Published ${items.length} assignments from ${saved.saved} shifts${missing ? ` (${missing} matches aren't on the schedule yet)` : ''}.`;
    } catch (cause) {
      error = cause.message;
    } finally {
      saving = false;
    }
  }
</script>

<section class="shifts" aria-label="Shift-based assignments">
  <header class="sh-head">
    <div>
      <h3>Shift-based assignments</h3>
      <p>
        Each scout watches one spot on the field (Red 1 to Blue 3) for a run of matches, scouting whichever robot stands
        there, then takes a break while the next scout on that spot takes over.
        {#if schedule.length}Qualification matches Q{range.first}–Q{range.last}.{/if}
      </p>
    </div>
    {#if canEdit}
      <div class="sh-actions">
        <button class="btn btn-outline btn-sm" on:click={() => (showAuto = !showAuto)}
          ><Wand2 size={15} /> Auto-plan</button
        >
        <button class="btn btn-outline btn-sm" disabled={saving || problems.length > 0} on:click={() => save()}
          >Save</button
        >
        <button
          class="btn btn-primary btn-sm"
          disabled={saving || problems.length > 0 || !shifts.length}
          on:click={() => save({ publish: true })}><Sparkles size={15} /> Save and publish</button
        >
      </div>
    {/if}
  </header>

  {#if error}<div class="status-message status-error" role="alert">{error}</div>{/if}
  {#if notice}<div class="status-message status-success" role="status">{notice}</div>{/if}

  {#if showAuto}
    <div class="sh-auto" transition:slide={{ duration: 180 }}>
      <div class="auto-row">
        <label class="auto-field"
          >Shift length (matches)
          <input class="form-input" type="number" min="1" max="40" bind:value={autoLength} />
        </label>
        <p class="auto-hint">
          Scouts are dealt to spots in the order picked (1st → Red 1, 2nd → Red 2 … 7th → Red 1 again). Twelve scouts
          give every spot two scouts who take turns.
        </p>
      </div>
      <div class="auto-scouts" role="group" aria-label="Scouts in the rotation">
        {#each scouts as scout (scout.id)}
          {@const on = autoScouts.includes(scout.id)}
          <button
            type="button"
            class="chip"
            class:on
            aria-pressed={on}
            on:click={() => (autoScouts = on ? autoScouts.filter((id) => id !== scout.id) : [...autoScouts, scout.id])}
            >{#if on}<span class="chip-n">{autoScouts.indexOf(scout.id) + 1}</span>{/if}{names.get(scout.id)}</button
          >
        {:else}
          <p class="muted">Nobody holds a match scouting role yet (People &gt; competition roles).</p>
        {/each}
      </div>
      <div>
        <button class="btn btn-primary btn-sm" disabled={!autoScouts.length} on:click={runAuto}>Build the plan</button>
      </div>
    </div>
  {/if}

  {#if notes.length}
    <ul class="sh-notes">
      {#each notes as note}<li>{note}</li>{/each}
    </ul>
  {/if}
  {#if problems.length}
    <ul class="sh-problems" role="alert">
      {#each problems as problem}<li>{problem}</li>{/each}
    </ul>
  {/if}

  {#if loading}
    <p class="muted">Loading the schedule and scouts…</p>
  {:else}
    <div class="lanes">
      {#each lanes as lane (lane.key)}
        <section class="lane {lane.alliance}" aria-label={lane.label}>
          <header class="lane-head">
            <b>{lane.label}</b>
            <span class="lane-cover">{coverage[lane.key]} of {totalMatches} matches</span>
            <div class="lane-track" aria-hidden="true">
              {#each lane.shifts as shift (shift.id)}
                <i style:left={left(shift)} style:width={width(shift)} title={names.get(shift.userId) || 'No scout'}
                ></i>
              {/each}
            </div>
          </header>
          <div class="lane-shifts">
            {#each lane.shifts as shift (shift.id)}
              <div class="shift" transition:slide={{ duration: 150 }}>
                <label class="sf-range"
                  ><span>Q</span><input
                    class="form-input"
                    type="number"
                    min={range.first}
                    max={range.last}
                    value={shift.start}
                    aria-label="First match"
                    disabled={!canEdit}
                    on:change={(e) => update(shift.id, { start: Number(e.currentTarget.value) })}
                  /></label
                >
                <label class="sf-range"
                  ><span>to Q</span><input
                    class="form-input"
                    type="number"
                    min={range.first}
                    max={range.last}
                    value={shift.end}
                    aria-label="Last match"
                    disabled={!canEdit}
                    on:change={(e) => update(shift.id, { end: Number(e.currentTarget.value) })}
                  /></label
                >
                <div class="sf-scout">
                  <Select
                    value={shift.userId || ''}
                    disabled={!canEdit}
                    aria-label={`Scout for ${lane.label}`}
                    on:change={(e) => update(shift.id, { userId: e.currentTarget?.value || e.detail?.value || null })}
                  >
                    <option value="">Pick a scout</option>
                    {#each scouts as scout (scout.id)}<option value={scout.id}>{names.get(scout.id)}</option>{/each}
                  </Select>
                </div>
                {#if canEdit}
                  <button class="icon-btn" aria-label="Remove shift" on:click={() => remove(shift.id)}
                    ><Trash2 size={15} /></button
                  >
                {/if}
              </div>
            {:else}
              <p class="muted lane-empty">No shifts on this spot.</p>
            {/each}
          </div>
          {#if canEdit}
            <button class="lane-add" on:click={() => addShift(lane.key)}><Plus size={14} /> Add shift</button>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</section>

<style>
  .shifts {
    display: grid;
    gap: var(--space-4);
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
  }
  .sh-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .sh-head h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 500;
  }
  .sh-head p {
    margin: var(--space-1) 0 0;
    max-width: 52rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .sh-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .sh-auto {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .auto-row {
    display: flex;
    gap: var(--space-4);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .auto-field {
    display: grid;
    gap: var(--space-1);
    width: 12rem;
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .auto-hint {
    flex: 1;
    min-width: 16rem;
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .auto-scouts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2rem;
    padding: 0 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .chip.on {
    border-color: color-mix(in srgb, var(--accent) 60%, transparent);
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-1));
    color: var(--text-strong, var(--text));
  }
  .chip-n {
    display: grid;
    place-items: center;
    min-width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 0.7rem;
    font-weight: 600;
  }
  .sh-notes,
  .sh-problems {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    font-size: 0.88rem;
  }
  .sh-notes {
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-secondary);
  }
  .sh-problems {
    border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
    background: color-mix(in srgb, var(--danger) 10%, var(--surface-1));
    color: var(--text);
  }
  /* Six lanes, three across on wide screens (red row, then blue row), one per row on phones. */
  .lanes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }
  @media (max-width: 1200px) {
    .lanes {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 700px) {
    .lanes {
      grid-template-columns: 1fr;
    }
  }
  .lane {
    display: grid;
    align-content: start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-top: 3px solid var(--lane-color);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .lane.red {
    --lane-color: var(--alliance-red-text);
  }
  .lane.blue {
    --lane-color: var(--alliance-blue-text);
  }
  .lane-head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2);
    align-items: baseline;
  }
  .lane-head b {
    font-weight: 500;
    color: var(--text-strong, var(--text));
  }
  .lane-cover {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  /* The lane's coverage at a glance: each shift as a bar across the schedule. */
  .lane-track {
    position: relative;
    grid-column: 1 / -1;
    height: 0.4rem;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    overflow: hidden;
  }
  .lane-track i {
    position: absolute;
    top: 0;
    bottom: 0;
    border-right: 2px solid var(--surface-1);
    background: color-mix(in srgb, var(--lane-color) 70%, transparent);
  }
  .lane-shifts {
    display: grid;
    gap: var(--space-2);
  }
  .shift {
    display: grid;
    grid-template-columns: 4.6rem 5.4rem minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: center;
  }
  .sf-range {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .sf-range input {
    width: 100%;
    min-width: 0;
    padding-inline: 0.45rem;
  }
  .sf-scout {
    min-width: 0;
  }
  .sf-scout :global(.form-group) {
    margin: 0;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover {
    color: var(--danger);
  }
  .lane-empty {
    font-size: 0.85rem;
  }
  .lane-add {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    justify-self: start;
    padding: 0.3rem 0.7rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .lane-add:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  @media (max-width: 600px) {
    .shift {
      grid-template-columns: 1fr 1fr auto;
    }
    .sf-scout {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>

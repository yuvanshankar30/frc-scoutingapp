<script>
  // Scouting Admin > Assignments > Shifts. A shift is a run of qualification matches; inside it, each seat is one scout
  // on one field spot (Red 1 ... Blue 3), who scouts whichever robot stands there in every match of the shift.
  //   - Shift-based assignments: one card per shift, seats per spot. A spot can have several scouts, and "Quick
  //     assign" puts one scout on several spots at once (a whole alliance, say).
  //   - General shifts: the same shifts as rosters. Pick a shift, add people, and they are seated in order (1st Red 1
  //     ... 6th Blue 3, 7th Red 1 again). Editing a roster rewrites that shift's seats above, and the other way round.
  //   - Each scout's matches: from the TBA schedule, exactly which robot each scout watches in each match.
  // Save keeps the plan; Publish also turns it into the per-match assignments scouts see under My assignments.
  // Logic: src/lib/scouting/shiftPlan.js.
  import { onMount } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import { ArrowDown, ArrowUp, Plus, Search, Sparkles, Trash2, UserPlus, Wand2, X } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scouting/scoutingEvent.js';
  import { requestConfirmation } from '$lib/app/confirmation.js';
  import {
    SLOTS,
    assignmentsFromShifts,
    autoPlan,
    groupShifts,
    qualRange,
    rosterOf,
    rosterSlot,
    rowsFromRoster,
    scoutMatches,
    validateShifts
  } from '$lib/scouting/shiftPlan.js';

  let eventKey = '';
  let schedule = [];
  let scouts = [];
  let rows = [];
  let canEdit = false;
  let loading = true;
  let saving = false;
  let dirty = false;
  let error = '';
  let notice = '';
  let notes = [];

  let shiftLength = 8;
  let showAuto = false;
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
      rows = (shiftsRes.shifts || []).map((row) => ({ ...row, id: row.id || newId() }));
      canEdit = Boolean(shiftsRes.canEdit);
      dirty = false;
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
  $: nameOf = (id) => (id ? names.get(id) || 'Former scout' : 'Open seat');
  $: problems = validateShifts(rows, { firstMatch: range.first, lastMatch: range.last, names });
  $: shifts = groupShifts(rows);
  $: work = scoutMatches(rows, schedule);
  $: openSeats = rows.filter((row) => !row.userId).length;

  function setRows(next) {
    rows = next;
    dirty = true;
    notice = '';
  }

  // --- Shifts
  function addShift() {
    const after = rows.reduce((max, row) => Math.max(max, row.end ?? 0), range.first - 1);
    const start = Math.min(after + 1, range.last);
    const end = Math.min(start + Math.max(1, Number(shiftLength) || 1) - 1, range.last);
    if (shifts.some((shift) => shift.start === start && shift.end === end)) return;
    // A new shift starts with an open seat on every spot.
    setRows([...rows, ...SLOTS.map((slot) => ({ id: newId(), slot: slot.key, start, end, userId: null }))]);
    activeKey = `${start}-${end}`;
  }
  function setRange(shift, changes) {
    const start = Number(changes.start ?? shift.start);
    const end = Number(changes.end ?? shift.end);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return;
    setRows(rows.map((row) => (row.start === shift.start && row.end === shift.end ? { ...row, start, end } : row)));
    if (activeKey === shift.key) activeKey = `${start}-${end}`;
  }
  async function removeShift(shift) {
    const filled = shift.rows.filter((row) => row.userId).length;
    if (
      filled &&
      !(await requestConfirmation({
        title: `Remove shift ${shift.number}`,
        message: `Q${shift.start}–Q${shift.end} and its ${filled} scout${filled === 1 ? '' : 's'} come off the plan.`,
        confirmLabel: 'Remove'
      }))
    )
      return;
    setRows(rows.filter((row) => !(row.start === shift.start && row.end === shift.end)));
  }

  // --- Seats
  const seatsOn = (shift, slotKey) => shift.rows.filter((row) => row.slot === slotKey);
  function addSeat(shift, slotKey, userId = null) {
    // Fill an open seat on that spot first; otherwise add another seat (a second scout on the spot).
    const open = seatsOn(shift, slotKey).find((row) => !row.userId);
    if (open && userId) return setSeat(open.id, userId);
    setRows([...rows, { id: newId(), slot: slotKey, start: shift.start, end: shift.end, userId }]);
  }
  const setSeat = (id, userId) => setRows(rows.map((row) => (row.id === id ? { ...row, userId: userId || null } : row)));
  const removeSeat = (id) => setRows(rows.filter((row) => row.id !== id));

  // Quick assign: one scout, any spots in this shift.
  let quick = {};
  const quickHas = (shift, slotKey, userId) => seatsOn(shift, slotKey).some((row) => row.userId === userId);
  function toggleQuick(shift, slotKey) {
    const userId = quick[shift.key];
    if (!userId) return;
    const seat = seatsOn(shift, slotKey).find((row) => row.userId === userId);
    if (seat) removeSeat(seat.id);
    else addSeat(shift, slotKey, userId);
  }
  function quickAlliance(shift, alliance) {
    const userId = quick[shift.key];
    if (!userId) return;
    const spots = SLOTS.filter((slot) => slot.alliance === alliance);
    const all = spots.every((slot) => quickHas(shift, slot.key, userId));
    let next = rows;
    for (const slot of spots) {
      const seat = next.find(
        (row) => row.start === shift.start && row.end === shift.end && row.slot === slot.key && row.userId === userId
      );
      if (all) next = next.filter((row) => row !== seat);
      else if (!seat) {
        const open = next.find(
          (row) => row.start === shift.start && row.end === shift.end && row.slot === slot.key && !row.userId
        );
        next = open
          ? next.map((row) => (row === open ? { ...row, userId } : row))
          : [...next, { id: newId(), slot: slot.key, start: shift.start, end: shift.end, userId }];
      }
    }
    setRows(next);
  }

  // --- General shifts (rosters)
  let activeKey = '';
  let rosterQuery = '';
  $: if (shifts.length && !shifts.some((shift) => shift.key === activeKey)) activeKey = shifts[0].key;
  $: active = shifts.find((shift) => shift.key === activeKey) || null;
  $: roster = active ? rosterOf(active.rows) : [];
  $: inRoster = new Set(roster.map((row) => row.userId).filter(Boolean));
  $: candidates = scouts.filter(
    (scout) =>
      !inRoster.has(scout.id) && (!rosterQuery.trim() || nameOf(scout.id).toLowerCase().includes(rosterQuery.trim().toLowerCase()))
  );

  function writeRoster(userIds) {
    if (!active) return;
    const others = rows.filter((row) => !(row.start === active.start && row.end === active.end));
    const seats = rowsFromRoster(userIds, { start: active.start, end: active.end, newId });
    // An empty roster keeps the shift, as six open seats.
    setRows([
      ...others,
      ...(seats.length
        ? seats
        : SLOTS.map((slot) => ({ id: newId(), slot: slot.key, start: active.start, end: active.end, userId: null })))
    ]);
  }
  const rosterIds = () => roster.map((row) => row.userId);
  // Adding someone fills the first open seat, else seats them after everyone else.
  function addToRoster(ids) {
    const next = rosterIds();
    for (const id of ids) {
      const open = next.indexOf(null);
      if (open !== -1) next[open] = id;
      else next.push(id);
    }
    writeRoster(next);
  }
  function moveInRoster(index, direction) {
    const next = rosterIds();
    const to = index + direction;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    writeRoster(next);
  }
  const replaceInRoster = (index, id) => writeRoster(rosterIds().map((old, i) => (i === index ? id || null : old)));
  const removeFromRoster = (index) => writeRoster(rosterIds().filter((_, i) => i !== index));
  const addOpenSeat = () => writeRoster([...rosterIds(), null]);
  // Whether the stored seats differ from what the roster order gives (someone sits on more than one spot, say).
  $: reseats =
    active &&
    roster.some((row, index) => row.slot !== rosterSlot(index).key);

  // --- Each scout's matches
  let viewScout = '';
  $: busyScouts = scouts.filter((scout) => work.has(scout.id));
  $: if (busyScouts.length && !work.has(viewScout)) viewScout = busyScouts[0].id;
  $: viewWork = work.get(viewScout) || [];

  async function runAuto() {
    if (
      rows.length &&
      !(await requestConfirmation({
        title: 'Replace the plan',
        message: 'Auto-plan replaces every shift. Nothing is saved until you save or publish.',
        confirmLabel: 'Replace'
      }))
    )
      return;
    const result = autoPlan({ scouts: autoScouts, length: shiftLength, firstMatch: range.first, lastMatch: range.last });
    setRows(result.shifts.map((row) => ({ ...row, id: newId() })));
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
      await post('/api/scout-shifts', { event_key: eventKey, shifts: rows });
      dirty = false;
      if (!publish) {
        notice = `Saved ${shifts.length} shift${shifts.length === 1 ? '' : 's'}.`;
        return;
      }
      const { items, missing } = assignmentsFromShifts(rows, schedule);
      if (!items.length) throw new Error('No match in these shifts is on the schedule yet, or no seat has a scout.');
      await post('/api/scout-assignments', { action: 'bulk-assign', scouting_type: 'data', items });
      notice = `Published ${items.length} match assignments from ${shifts.length} shifts. Each scout sees their robots under My assignments${missing ? ` (${missing} matches aren't on the schedule yet)` : ''}.`;
    } catch (cause) {
      error = cause.message;
    } finally {
      saving = false;
    }
  }
</script>

<section class="planner" aria-label="Shift-based assignments">
  <header class="pl-head">
    <div>
      <h3>Shift-based assignments</h3>
      <p>
        Scouts work in shifts: each seat is a spot on the field, and its scout scouts whichever robot stands there in
        every match of the shift, then takes a break.
        {#if schedule.length}Qualification matches Q{range.first}–Q{range.last}.{/if}
      </p>
    </div>
    {#if canEdit}
      <div class="pl-actions">
        <label class="len"
          >Matches per shift
          <input class="form-input" type="number" min="1" max="40" bind:value={shiftLength} />
        </label>
        <button class="btn btn-outline btn-sm" on:click={() => (showAuto = !showAuto)}
          ><Wand2 size={15} /> Auto-plan</button
        >
        <button class="btn btn-outline btn-sm" disabled={saving || problems.length > 0 || !dirty} on:click={() => save()}
          >{dirty ? 'Save' : 'Saved'}</button
        >
        <button
          class="btn btn-primary btn-sm"
          disabled={saving || problems.length > 0 || !rows.length}
          on:click={() => save({ publish: true })}><Sparkles size={15} /> Save and publish</button
        >
      </div>
    {/if}
  </header>

  {#if error}<div class="status-message status-error" role="alert">{error}</div>{/if}
  {#if notice}<div class="status-message status-success" role="status">{notice}</div>{/if}

  {#if showAuto}
    <div class="panel auto" transition:slide={{ duration: 180 }}>
      <p class="muted">
        Scouts are dealt to spots in the order picked (1st → Red 1 … 6th → Blue 3, 7th → Red 1 again), and every shift
        hands each spot to its next scout. Twelve scouts give every spot two scouts who take turns.
      </p>
      <div class="chips" role="group" aria-label="Scouts in the rotation">
        {#each scouts as scout (scout.id)}
          {@const on = autoScouts.includes(scout.id)}
          <button
            type="button"
            class="chip"
            class:on
            aria-pressed={on}
            on:click={() => (autoScouts = on ? autoScouts.filter((id) => id !== scout.id) : [...autoScouts, scout.id])}
            >{#if on}<span class="chip-n">{autoScouts.indexOf(scout.id) + 1}</span>{/if}{nameOf(scout.id)}</button
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
    <ul class="notes">
      {#each notes as note}<li>{note}</li>{/each}
    </ul>
  {/if}
  {#if problems.length}
    <ul class="problems" role="alert">
      {#each problems as problem}<li>{problem}</li>{/each}
    </ul>
  {/if}

  {#if loading}
    <p class="muted">Loading the schedule and scouts…</p>
  {:else}
    <div class="summary">
      <span><b>{shifts.length}</b> shift{shifts.length === 1 ? '' : 's'}</span>
      <span><b>{rows.length - openSeats}</b> filled seat{rows.length - openSeats === 1 ? '' : 's'}</span>
      {#if openSeats}<span class="warn"><b>{openSeats}</b> open</span>{/if}
      <span><b>{work.size}</b> scout{work.size === 1 ? '' : 's'} working</span>
    </div>

    <div class="shift-list">
      {#each shifts as shift (shift.key)}
        <article class="shift-card" transition:slide={{ duration: 160 }}>
          <header class="sc-head">
            <h4>Shift {shift.number}</h4>
            <label class="range"
              >Q<input
                class="form-input"
                type="number"
                min={range.first}
                max={range.last}
                value={shift.start}
                aria-label={`Shift ${shift.number} first match`}
                disabled={!canEdit}
                on:change={(e) => setRange(shift, { start: e.currentTarget.value })}
              /></label
            >
            <span class="to">to</span>
            <label class="range"
              >Q<input
                class="form-input"
                type="number"
                min={range.first}
                max={range.last}
                value={shift.end}
                aria-label={`Shift ${shift.number} last match`}
                disabled={!canEdit}
                on:change={(e) => setRange(shift, { end: e.currentTarget.value })}
              /></label
            >
            <span class="muted count">{(shift.end ?? 0) - (shift.start ?? 0) + 1} matches</span>
            {#if canEdit}
              <button class="icon-btn" aria-label={`Remove shift ${shift.number}`} on:click={() => removeShift(shift)}
                ><Trash2 size={15} /></button
              >
            {/if}
          </header>

          <div class="spots">
            {#each SLOTS as slot (slot.key)}
              <div class="spot {slot.alliance}">
                <span class="spot-name">{slot.label}</span>
                {#each seatsOn(shift, slot.key) as seat (seat.id)}
                  <div class="seat" class:open={!seat.userId}>
                    <Select
                      value={seat.userId || ''}
                      disabled={!canEdit}
                      compact
                      aria-label={`${slot.label}, shift ${shift.number}`}
                      on:change={(e) => setSeat(seat.id, e.currentTarget.value)}
                    >
                      <option value="">Open seat</option>
                      {#each scouts as scout (scout.id)}<option value={scout.id}>{nameOf(scout.id)}</option>{/each}
                    </Select>
                    {#if canEdit}
                      <button class="x" aria-label={`Remove this seat on ${slot.label}`} on:click={() => removeSeat(seat.id)}
                        ><X size={13} /></button
                      >
                    {/if}
                  </div>
                {/each}
                {#if canEdit}
                  <button class="add-seat" on:click={() => addSeat(shift, slot.key)}
                    ><Plus size={13} /> {seatsOn(shift, slot.key).length ? 'Another scout' : 'Add scout'}</button
                  >
                {/if}
              </div>
            {/each}
          </div>

          {#if canEdit}
            <div class="quick">
              <span class="quick-label">Quick assign</span>
              <div class="quick-who">
                <Select bind:value={quick[shift.key]} compact wide aria-label="Scout to place">
                  <option value="">Pick a scout…</option>
                  {#each scouts as scout (scout.id)}<option value={scout.id}>{nameOf(scout.id)}</option>{/each}
                </Select>
              </div>
              <div class="quick-spots" role="group" aria-label="Spots for this scout">
                {#each SLOTS as slot (slot.key)}
                  {@const on = quick[shift.key] && quickHas(shift, slot.key, quick[shift.key])}
                  <button
                    class="spot-toggle {slot.alliance}"
                    class:on
                    aria-pressed={Boolean(on)}
                    disabled={!quick[shift.key]}
                    on:click={() => toggleQuick(shift, slot.key)}>{slot.label}</button
                  >
                {/each}
                <button class="spot-toggle red" disabled={!quick[shift.key]} on:click={() => quickAlliance(shift, 'red')}
                  >All red</button
                >
                <button class="spot-toggle blue" disabled={!quick[shift.key]} on:click={() => quickAlliance(shift, 'blue')}
                  >All blue</button
                >
              </div>
            </div>
          {/if}
        </article>
      {:else}
        <p class="muted empty">No shifts yet. Add one, build them with Auto-plan, or use General shifts below.</p>
      {/each}
      {#if canEdit}
        <button class="add-shift" on:click={addShift}><Plus size={15} /> Add shift (next {shiftLength} matches)</button>
      {/if}
    </div>

    <section class="panel general" aria-labelledby="general-title">
      <header class="sub-head">
        <div>
          <h3 id="general-title">General shifts</h3>
          <p class="muted">
            Fill a whole shift at once: add people and they are seated in order, 1st on Red 1 through 6th on Blue 3, and
            a 7th sits on Red 1 again as a second scout. The shift cards above update as you go.
          </p>
        </div>
      </header>
      <div class="shift-tabs" role="tablist" aria-label="Shifts">
        {#each shifts as shift (shift.key)}
          <button
            role="tab"
            class:on={shift.key === activeKey}
            aria-selected={shift.key === activeKey}
            on:click={() => (activeKey = shift.key)}
            >Shift {shift.number}<small>Q{shift.start}–{shift.end}</small></button
          >
        {/each}
        {#if canEdit}
          <button class="tab-add" on:click={addShift}><Plus size={14} /> New shift</button>
        {/if}
      </div>

      {#if active}
        <div class="roster-wrap" in:fade={{ duration: 120 }}>
          <div class="roster">
            <div class="roster-head">
              <b>Shift {active.number}</b>
              <span class="muted">Q{active.start}–Q{active.end} · {roster.filter((row) => row.userId).length} people</span>
            </div>
            {#if reseats}
              <p class="hint">
                Some seats here aren't in roster order (someone covers several spots). Changing the roster seats everyone
                in order again.
              </p>
            {/if}
            <ol class="roster-list">
              {#each roster as seat, index (seat.id)}
                {@const at = rosterSlot(index)}
                <li transition:slide={{ duration: 120 }}>
                  <span class="pos {at.alliance}">{at.label}</span>
                  <div class="roster-pick">
                    <Select
                      value={seat.userId || ''}
                      disabled={!canEdit}
                      compact
                      wide
                      aria-label={`${at.label} in shift ${active.number}`}
                      on:change={(e) => replaceInRoster(index, e.currentTarget.value)}
                    >
                      <option value="">Open seat</option>
                      {#each scouts as scout (scout.id)}<option value={scout.id}>{nameOf(scout.id)}</option>{/each}
                    </Select>
                  </div>
                  {#if canEdit}
                    <button class="icon-btn" aria-label="Move up" disabled={index === 0} on:click={() => moveInRoster(index, -1)}
                      ><ArrowUp size={14} /></button
                    >
                    <button
                      class="icon-btn"
                      aria-label="Move down"
                      disabled={index === roster.length - 1}
                      on:click={() => moveInRoster(index, 1)}><ArrowDown size={14} /></button
                    >
                    <button class="icon-btn" aria-label="Remove from shift" on:click={() => removeFromRoster(index)}
                      ><X size={14} /></button
                    >
                  {/if}
                </li>
              {/each}
            </ol>
            {#if canEdit}
              <button class="add-seat" on:click={addOpenSeat}><Plus size={13} /> Add an open seat</button>
            {/if}
          </div>

          {#if canEdit}
            <div class="people">
              <div class="people-head">
                <b><UserPlus size={15} /> Add people</b>
                {#if candidates.length}
                  <button class="btn btn-outline btn-sm" on:click={() => addToRoster(candidates.map((scout) => scout.id))}
                    >Add all {candidates.length}</button
                  >
                {/if}
              </div>
              <label class="search"
                ><Search size={14} /><input
                  class="form-input"
                  placeholder="Search scouts"
                  aria-label="Search scouts"
                  bind:value={rosterQuery}
                /></label
              >
              <div class="chips">
                {#each candidates as scout (scout.id)}
                  <button type="button" class="chip" on:click={() => addToRoster([scout.id])}
                    ><Plus size={12} /> {nameOf(scout.id)}</button
                  >
                {:else}
                  <p class="muted">{scouts.length ? 'Everyone is on this shift.' : 'Nobody holds a match scouting role yet.'}</p>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <p class="muted">Add a shift to fill it here.</p>
      {/if}
    </section>

    <section class="panel" aria-labelledby="work-title">
      <header class="sub-head">
        <div>
          <h3 id="work-title">Each scout's matches</h3>
          <p class="muted">
            From the Blue Alliance schedule: the robot each scout watches in every match of their shifts. Publishing sends
            these to each scout's My assignments.
          </p>
        </div>
      </header>
      {#if !busyScouts.length}
        <p class="muted">Nobody is seated yet.</p>
      {:else}
        <div class="chips" role="tablist" aria-label="Scouts">
          {#each busyScouts as scout (scout.id)}
            <button
              role="tab"
              class="chip"
              class:on={viewScout === scout.id}
              aria-selected={viewScout === scout.id}
              on:click={() => (viewScout = scout.id)}
              >{nameOf(scout.id)} <span class="chip-n">{work.get(scout.id).length}</span></button
            >
          {/each}
        </div>
        <div class="work-grid">
          {#each viewWork as item (`${item.number}-${item.slot}`)}
            <div class="work {item.slot.startsWith('red') ? 'red' : 'blue'}" class:unknown={!item.teamKey}>
              <b>Q{item.number}</b>
              <span class="team">{item.teamKey ? item.teamKey.replace('frc', '') : 'Not scheduled'}</span>
              <small>{item.slotLabel}</small>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</section>

<style>
  .planner {
    display: grid;
    gap: var(--space-4);
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
  }
  h3,
  h4 {
    margin: 0;
    font-weight: 500;
  }
  h3 {
    font-size: 1.1rem;
  }
  .pl-head,
  .sub-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .pl-head p,
  .sub-head p {
    margin: var(--space-1) 0 0;
    max-width: 56rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .pl-actions {
    display: flex;
    gap: var(--space-2);
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .len {
    display: grid;
    gap: 2px;
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-muted);
  }
  .len input {
    width: 6rem;
  }
  .panel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .notes,
  .problems {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-3) var(--space-6);
    border-radius: var(--radius-md);
    line-height: 1.5;
  }
  .notes {
    background: var(--surface-2);
    color: var(--text-secondary);
  }
  .problems {
    background: color-mix(in srgb, var(--danger, var(--accent)) 12%, transparent);
    color: var(--text-primary);
  }
  .summary {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .summary b {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .summary .warn b {
    color: var(--warning, var(--accent));
  }

  .shift-list {
    display: grid;
    gap: var(--space-3);
  }
  .shift-card {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .sc-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .sc-head h4 {
    margin-right: var(--space-2);
    font-size: 1rem;
  }
  .range {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .range input {
    width: 4.5rem;
  }
  .to {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .count {
    margin-right: auto;
    font-size: var(--text-sm);
  }
  .spots {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-2);
  }
  @media (max-width: 1100px) {
    .spots {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 560px) {
    .spots {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .spot {
    --spot: var(--alliance-red-text);
    display: grid;
    align-content: start;
    gap: 6px;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--spot) 7%, var(--surface-2));
    box-shadow: inset 0 2px 0 var(--spot);
  }
  .spot.blue {
    --spot: var(--alliance-blue-text);
  }
  .spot-name {
    color: var(--spot);
    font-size: var(--text-xs, 0.75rem);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .seat {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .seat :global(.select-wrap),
  .seat > :global(*:first-child) {
    flex: 1;
    min-width: 0;
  }
  .seat.open :global(button) {
    color: var(--text-muted);
  }
  .x {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .x:hover {
    background: var(--surface-3, var(--surface-2));
    color: var(--text-primary);
  }
  .add-seat,
  .add-shift,
  .tab-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0.35rem 0.6rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      border-color 0.15s,
      color 0.15s;
  }
  .add-seat:hover,
  .add-shift:hover,
  .tab-add:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .add-shift {
    padding: var(--space-3);
  }
  .quick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .quick-label {
    color: var(--text-muted);
    font-size: var(--text-xs, 0.75rem);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .quick-who {
    min-width: 12rem;
  }
  .quick-spots {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .spot-toggle {
    --spot: var(--alliance-red-text);
    padding: 0.3rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--spot) 45%, var(--border));
    border-radius: var(--radius-button, 999px);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .spot-toggle.blue {
    --spot: var(--alliance-blue-text);
  }
  .spot-toggle.on {
    background: color-mix(in srgb, var(--spot) 22%, transparent);
    color: var(--text-primary);
  }
  .spot-toggle:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .shift-tabs {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .shift-tabs [role='tab'] {
    display: grid;
    gap: 1px;
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }
  .shift-tabs [role='tab'] small {
    color: var(--text-muted);
    font-size: var(--text-xs, 0.72rem);
  }
  .shift-tabs [role='tab'].on {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--text-primary);
  }
  .roster-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: var(--space-4);
  }
  @media (max-width: 900px) {
    .roster-wrap {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .roster,
  .people {
    display: grid;
    align-content: start;
    gap: var(--space-2);
  }
  .roster-head,
  .people-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .people-head b {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .roster-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .roster-list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pos {
    --spot: var(--alliance-red-text);
    flex-shrink: 0;
    width: 4.2rem;
    padding: 0.25rem 0;
    border-radius: var(--radius-sm, 6px);
    background: color-mix(in srgb, var(--spot) 16%, transparent);
    color: var(--spot);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  .pos.blue {
    --spot: var(--alliance-blue-text);
  }
  .roster-pick {
    flex: 1;
    min-width: 0;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
  }
  .search input {
    flex: 1;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-button, 999px);
    background: var(--surface-2);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      color 0.15s;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--text-primary);
  }
  .chip-n {
    display: inline-grid;
    place-items: center;
    min-width: 1.3rem;
    height: 1.3rem;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--surface-3, var(--surface-1));
    font-size: var(--text-xs, 0.72rem);
    font-variant-numeric: tabular-nums;
  }
  .work-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
    gap: 6px;
  }
  .work {
    --spot: var(--alliance-red-text);
    display: grid;
    gap: 1px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    box-shadow: inset 3px 0 0 var(--spot);
  }
  .work.blue {
    --spot: var(--alliance-blue-text);
  }
  .work .team {
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
  }
  .work small {
    color: var(--text-muted);
  }
  .work.unknown .team {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .empty {
    padding: var(--space-4);
    border: 1px dashed var(--border);
    border-radius: var(--radius-lg);
    text-align: center;
  }
</style>

<script>
  // Scouting Admin > Training. Turn training mode on for a competition code, pick real past matches from The Blue
  // Alliance (search, or a random one), and assign a scout to each robot. Scouts then see an ordinary assignment
  // under the training code, with a link to the match video on the scouting form.
  import { onMount } from 'svelte';
  import { Check, Dices, ExternalLink, GraduationCap, Plus, Search, Trash2, Video, WandSparkles } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { displayEventCode, normalizeEventCode } from '$lib/scouting/eventCode.js';
  import { autoFillSlots, pickRandom, searchPastEvents, youtubeUrl } from '$lib/scouting/training.js';

  const THIS_YEAR = new Date().getFullYear();
  const YEARS = Array.from({ length: THIS_YEAR - 2015 + 1 }, (_, index) => THIS_YEAR - index);

  let loading = true;
  let error = '';
  let notice = '';
  let events = [];
  let activeEventKey = '';
  let selected = '';
  let matches = [];
  let assignments = [];
  let people = [];
  let newCode = '';
  let busy = '';

  // Finding matches.
  let year = THIS_YEAR;
  let eventsByYear = {};
  let yearLoading = false;
  let query = '';
  let tbaEvent = null;
  let tbaMatches = [];
  let matchesLoading = false;
  let level = 'qm';
  let videoOnly = true;
  let highlighted = '';

  // Assigning.
  let pool = [];
  let poolPick = '';

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()), ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload.data;
  };
  const post = (body) =>
    api('/api/scouting-training', { method: 'POST', body: JSON.stringify({ event_key: selected, ...body }) });

  $: trainingEvents = events.filter((event) => event.training);
  $: otherEvents = events.filter((event) => !event.training);
  $: selectedEvent = events.find((event) => event.event_key === selected) || null;
  $: pastEvents = searchPastEvents(eventsByYear[year] || [], query);
  $: shownMatches = tbaMatches.filter(
    (match) =>
      (level === 'qm' ? match.comp_level === 'qm' : match.comp_level !== 'qm') && (!videoOnly || match.video_key)
  );
  $: addedSources = new Map(matches.map((match) => [match.source_match_key, match.match_key]));
  $: slotOwner = new Map(assignments.map((row) => [`${row.match_key}|${row.team_key}`, row]));
  $: slots = matches.flatMap((match) =>
    [...match.red_team_keys, ...match.blue_team_keys].map((team_key) => ({
      match_key: match.match_key,
      team_key,
      user_id: slotOwner.get(`${match.match_key}|${team_key}`)?.assigned_user || null
    }))
  );
  $: openSlots = slots.filter((slot) => !slot.user_id).length;
  $: personName = new Map(people.map((person) => [person.id, person.name]));

  function flash(message) {
    notice = message;
    error = '';
    setTimeout(() => {
      if (notice === message) notice = '';
    }, 3500);
  }

  async function loadOverview(eventKey = selected) {
    try {
      const data = await api(
        `/api/scouting-training?resource=overview${eventKey ? `&event_key=${encodeURIComponent(eventKey)}` : ''}`
      );
      events = data.events;
      activeEventKey = data.active_event_key || '';
      matches = data.matches;
      assignments = data.assignments;
      people = data.people;
      if (!selected && !eventKey) {
        const first = data.events.find((event) => event.training);
        if (first) {
          selected = first.event_key;
          await loadOverview(first.event_key);
        }
      }
    } catch (exception) {
      error = exception.message;
    } finally {
      loading = false;
    }
  }

  async function choose(eventKey) {
    selected = eventKey;
    matches = [];
    assignments = [];
    await loadOverview(eventKey);
  }

  async function setTraining(eventKey, enabled) {
    busy = `toggle:${eventKey}`;
    try {
      await api('/api/scouting-training', {
        method: 'POST',
        body: JSON.stringify({ action: 'set-training', event_key: eventKey, enabled })
      });
      if (enabled) await choose(eventKey);
      else {
        if (selected === eventKey) selected = '';
        await loadOverview(selected);
      }
      flash(
        `${displayEventCode(eventKey)} ${enabled ? 'is now a training competition' : 'is back to a normal competition'}.`
      );
    } catch (exception) {
      error = exception.message;
    } finally {
      busy = '';
    }
  }

  async function createCode() {
    const code = normalizeEventCode(newCode);
    if (!code) {
      error = 'Use the year followed by a name, like 2026training.';
      return;
    }
    newCode = '';
    await setTraining(code, true);
  }

  async function loadYear(nextYear) {
    year = Number(nextYear);
    if (eventsByYear[year]) return;
    yearLoading = true;
    try {
      eventsByYear = { ...eventsByYear, [year]: await api(`/api/scouting-training?resource=events&year=${year}`) };
    } catch (exception) {
      error = exception.message;
    } finally {
      yearLoading = false;
    }
  }

  async function openEvent(event) {
    tbaEvent = event;
    tbaMatches = [];
    highlighted = '';
    matchesLoading = true;
    try {
      tbaMatches = await api(`/api/scouting-training?resource=matches&tba_event_key=${encodeURIComponent(event.key)}`);
    } catch (exception) {
      error = exception.message;
    } finally {
      matchesLoading = false;
    }
    if (tbaMatches.length && !tbaMatches.some((match) => match.comp_level === 'qm')) level = 'playoffs';
  }

  // A random finished event from the current search (or the whole season), then a random match in it that has a
  // video and is not already being used. A few tries, because some events have no videos on TBA.
  async function randomMatch() {
    busy = 'random';
    try {
      await loadYear(year);
      const pickFrom = pastEvents.length ? pastEvents : searchPastEvents(eventsByYear[year] || [], '');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const event = pickRandom(pickFrom);
        if (!event) break;
        await openEvent(event);
        const candidates = tbaMatches.filter((match) => match.video_key && !addedSources.has(match.key));
        const match = pickRandom(candidates.filter((entry) => entry.comp_level === 'qm')) || pickRandom(candidates);
        if (match) {
          level = match.comp_level === 'qm' ? 'qm' : 'playoffs';
          videoOnly = true;
          highlighted = match.key;
          return;
        }
      }
      error = 'Could not find a match with a video in those events. Try another season or search.';
    } finally {
      busy = '';
    }
  }

  async function addMatch(match) {
    busy = `add:${match.key}`;
    try {
      const row = await post({ action: 'add-match', source_match_key: match.key });
      matches = [...matches, row];
      highlighted = '';
      flash(`Added as training match ${row.match_key.split('_qm').pop()}.`);
    } catch (exception) {
      error = exception.message;
    } finally {
      busy = '';
    }
  }

  async function removeMatch(match) {
    busy = `remove:${match.match_key}`;
    try {
      await post({ action: 'remove-match', match_key: match.match_key });
      await loadOverview();
    } catch (exception) {
      error = exception.message;
    } finally {
      busy = '';
    }
  }

  async function assign(items) {
    if (!items.length) return;
    busy = 'assign';
    try {
      const data = await post({ action: 'assign', items });
      matches = data.matches;
      assignments = data.assignments;
    } catch (exception) {
      error = exception.message;
    } finally {
      busy = '';
    }
  }

  const setSlot = (match_key, team_key, user_id) => assign([{ match_key, team_key, user_id: user_id || null }]);

  async function autoFill() {
    const added = autoFillSlots(slots, pool);
    if (!added.length) {
      error = pool.length ? 'Every robot already has a scout.' : 'Add scouts to the pool first.';
      return;
    }
    await assign(added);
    flash(`Assigned ${added.length} robot${added.length === 1 ? '' : 's'}.`);
  }

  function addToPool(id) {
    if (id && !pool.includes(id)) pool = [...pool, id];
    poolPick = '';
  }

  onMount(async () => {
    await Promise.all([loadOverview(''), loadYear(THIS_YEAR)]);
  });
</script>

<section class="training" aria-labelledby="training-heading">
  <header class="training-head">
    <div>
      <h2 id="training-heading"><GraduationCap size={20} /> Training</h2>
      <p>
        Practice on real past matches. Turn training on for a competition code, add matches from The Blue Alliance, and
        give each robot a scout. Scouts get a normal assignment with the match video linked on the scouting form, and
        their reports stay under the training code.
      </p>
    </div>
  </header>

  {#if error}<p class="msg error" role="alert">{error}</p>{/if}
  {#if notice}<p class="msg ok" role="status">{notice}</p>{/if}

  <section class="panel codes">
    <h3>Training competitions</h3>
    {#if loading}<p class="muted">Loading…</p>{:else}
      <div class="code-list">
        {#each trainingEvents as event (event.event_key)}
          <div class="code-row" class:selected={selected === event.event_key}>
            <button
              class="code-open"
              on:click={() => choose(event.event_key)}
              aria-pressed={selected === event.event_key}
            >
              <span class="mono">{displayEventCode(event.event_key)}</span>{#if event.name}<small>{event.name}</small
                >{/if}
            </button>
            <label class="switch"
              ><input
                type="checkbox"
                checked
                disabled={busy === `toggle:${event.event_key}`}
                on:change={() => setTraining(event.event_key, false)}
              /><span>Training on</span></label
            >
          </div>
        {:else}
          <p class="muted">No competition is in training mode yet.</p>
        {/each}
      </div>
      <div class="code-actions">
        <form class="inline" on:submit|preventDefault={createCode}>
          <input
            class="form-input"
            placeholder="New code, e.g. 2026training"
            bind:value={newCode}
            aria-label="New training competition code"
          />
          <button class="btn btn-primary" type="submit" disabled={!newCode.trim() || Boolean(busy)}
            ><Plus size={15} /> Create</button
          >
        </form>
        {#if otherEvents.length}
          <Select
            class="form-select"
            value=""
            on:change={(event) => event.currentTarget.value && setTraining(event.currentTarget.value, true)}
            aria-label="Turn on training for an existing code"
          >
            <option value="" disabled>Turn on for an existing code…</option>
            {#each otherEvents as event (event.event_key)}<option
                value={event.event_key}
                disabled={event.event_key === activeEventKey}
                >{displayEventCode(event.event_key)}{event.name ? ` — ${event.name}` : ''}{event.event_key ===
                activeEventKey
                  ? ' (active event)'
                  : ''}</option
              >{/each}
          </Select>
        {/if}
      </div>
    {/if}
  </section>

  {#if selectedEvent?.training}
    <div class="workbench">
      <section class="panel finder" aria-labelledby="finder-heading">
        <div class="panel-title">
          <h3 id="finder-heading">Add matches</h3>
          <button class="btn btn-secondary" on:click={randomMatch} disabled={Boolean(busy)}
            ><Dices size={15} /> {busy === 'random' ? 'Picking…' : 'Random match'}</button
          >
        </div>
        <div class="search-row">
          <Select
            class="form-select"
            value={year}
            on:change={(event) => loadYear(event.currentTarget.value)}
            aria-label="Season"
          >
            {#each YEARS as option}<option value={option}>{option}</option>{/each}
          </Select>
          <label class="search"
            ><Search size={15} /><input
              placeholder="Search events: name, city, code or week 3"
              bind:value={query}
              aria-label="Search past events"
            /></label
          >
        </div>
        {#if yearLoading}<p class="muted">Loading {year} events…</p>
        {:else if !tbaEvent}
          <ul class="event-list">
            {#each pastEvents.slice(0, 60) as event (event.key)}
              <li>
                <button on:click={() => openEvent(event)}
                  ><b>{event.name}</b><span
                    >{event.key} · {event.city}{event.state_prov ? `, ${event.state_prov}` : ''} · {event.end_date}</span
                  ></button
                >
              </li>
            {:else}<li class="muted">No finished events match.</li>{/each}
          </ul>
          {#if pastEvents.length > 60}<p class="muted">
              Showing 60 of {pastEvents.length}. Search to narrow it down.
            </p>{/if}
        {:else}
          <div class="event-head">
            <button
              class="link"
              on:click={() => {
                tbaEvent = null;
                tbaMatches = [];
                highlighted = '';
              }}>← All events</button
            >
            <div><b>{tbaEvent.name}</b><span>{tbaEvent.key} · {tbaEvent.end_date}</span></div>
          </div>
          <div class="filters">
            <div class="seg" role="group" aria-label="Match type">
              <button class:on={level === 'qm'} aria-pressed={level === 'qm'} on:click={() => (level = 'qm')}
                >Qualifications</button
              >
              <button class:on={level !== 'qm'} aria-pressed={level !== 'qm'} on:click={() => (level = 'playoffs')}
                >Playoffs</button
              >
            </div>
            <label class="check"><input type="checkbox" bind:checked={videoOnly} /> With video only</label>
          </div>
          {#if matchesLoading}<p class="muted">Loading matches…</p>{:else}
            <ul class="match-list">
              {#each shownMatches as match (match.key)}
                {@const added = addedSources.get(match.key)}
                <li class:highlight={highlighted === match.key}>
                  <div class="m-label">
                    <b>{match.label}</b>{#if match.video_key}<a
                        href={youtubeUrl(match.video_key)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Watch ${match.label}`}><Video size={14} /></a
                      >{/if}
                  </div>
                  <div class="m-teams">
                    <span class="red">{match.red.map((key) => key.slice(3)).join(' ')}</span><span class="blue"
                      >{match.blue.map((key) => key.slice(3)).join(' ')}</span
                    >
                  </div>
                  <div class="m-score">{match.red_score ?? '–'}–{match.blue_score ?? '–'}</div>
                  {#if added}<span class="added"><Check size={14} /> Match {added.split('_qm').pop()}</span>
                  {:else}<button
                      class="btn btn-sm"
                      class:btn-primary={highlighted === match.key}
                      on:click={() => addMatch(match)}
                      disabled={Boolean(busy)}><Plus size={14} /> Add</button
                    >{/if}
                </li>
              {:else}<li class="muted">
                  {tbaMatches.length ? 'No matches with these filters.' : 'TBA has no matches for this event.'}
                </li>{/each}
            </ul>
          {/if}
        {/if}
      </section>

      <section class="panel assign" aria-labelledby="assign-heading">
        <div class="panel-title">
          <h3 id="assign-heading">Matches and scouts</h3>
          <span class="muted"
            >{matches.length} match{matches.length === 1 ? '' : 'es'} · {openSlots} open robot{openSlots === 1
              ? ''
              : 's'}</span
          >
        </div>
        <div class="pool">
          <div class="pool-row">
            <Select
              class="form-select"
              bind:value={poolPick}
              on:change={() => addToPool(poolPick)}
              aria-label="Add a scout to the pool"
            >
              <option value="" disabled>Add scouts to the pool…</option>
              {#each people.filter((person) => !pool.includes(person.id)) as person (person.id)}<option
                  value={person.id}>{person.name}</option
                >{/each}
            </Select>
            <button class="btn btn-primary" on:click={autoFill} disabled={!pool.length || !openSlots || Boolean(busy)}
              ><WandSparkles size={15} /> Fill {openSlots} open robot{openSlots === 1 ? '' : 's'}</button
            >
          </div>
          {#if pool.length}
            <div class="chips">
              {#each pool as id (id)}<button
                  class="chip"
                  on:click={() => (pool = pool.filter((entry) => entry !== id))}
                  aria-label={`Remove ${personName.get(id)} from the pool`}>{personName.get(id)} ×</button
                >{/each}
            </div>
          {:else}<p class="muted">
              Pick the scouts who are training, then fill every open robot at once. Each scout gets one robot per match,
              shared out evenly.
            </p>{/if}
        </div>

        {#each matches as match (match.match_key)}
          <article class="t-match">
            <header>
              <div>
                <b>Match {match.match_key.split('_qm').pop()}</b><span
                  >{match.source_event_name || match.source_event_key} · {match.source_label}</span
                >
              </div>
              <div class="t-actions">
                {#if match.video_key}<a
                    class="btn btn-sm"
                    href={youtubeUrl(match.video_key)}
                    target="_blank"
                    rel="noopener noreferrer"><ExternalLink size={13} /> Video</a
                  >{/if}
                <button
                  class="btn btn-sm icon"
                  aria-label={`Remove training match ${match.match_key.split('_qm').pop()}`}
                  on:click={() => removeMatch(match)}
                  disabled={Boolean(busy)}><Trash2 size={14} /></button
                >
              </div>
            </header>
            <div class="slots">
              {#each [['red', match.red_team_keys], ['blue', match.blue_team_keys]] as [alliance, teams] (alliance)}
                <div class="alliance {alliance}">
                  {#each teams as team (team)}
                    {@const row = slotOwner.get(`${match.match_key}|${team}`)}
                    <div class="slot">
                      <span class="team"
                        >{team.slice(3)}{#if row?.completed_at}<Check
                            size={13}
                            aria-label="Report submitted"
                          />{/if}</span
                      >
                      <Select
                        class="form-select"
                        compact
                        value={row?.assigned_user || ''}
                        disabled={Boolean(row?.completed_at) || busy === 'assign'}
                        on:change={(event) => setSlot(match.match_key, team, event.currentTarget.value)}
                        aria-label={`Scout for team ${team.slice(3)} in training match ${match.match_key.split('_qm').pop()}`}
                      >
                        <option value="">Unassigned</option>
                        {#each people as person (person.id)}<option value={person.id}>{person.name}</option>{/each}
                      </Select>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          </article>
        {:else}
          <p class="empty">No matches yet. Search for an event on the left, or press Random match.</p>
        {/each}
      </section>
    </div>
  {:else if !loading && selected}
    <p class="muted">{displayEventCode(selected)} is not in training mode.</p>
  {/if}
</section>

<style>
  .training {
    display: grid;
    gap: var(--space-4);
  }
  .training-head h2 {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    margin: 0;
  }
  .training-head p {
    margin: 0.4rem 0 0;
    max-width: 52rem;
    color: var(--text-muted);
    font-size: 0.88rem;
    line-height: 1.45;
  }
  .msg {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid;
    font-size: 0.88rem;
  }
  .msg.error {
    border-color: var(--red-base);
    background: var(--red-soft);
  }
  .msg.ok {
    border-color: var(--green-base);
    background: var(--green-soft);
  }
  .panel {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-1);
    min-width: 0;
  }
  .panel h3 {
    margin: 0;
    font-size: 1rem;
  }
  .panel-title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-2);
  }
  .panel-title .btn,
  .inline .btn,
  .pool-row .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .code-list {
    display: grid;
    gap: var(--space-2);
  }
  .code-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .code-row.selected {
    border-color: var(--brand-gold-strong);
    box-shadow: inset 3px 0 0 var(--brand-gold-strong);
  }
  .code-open {
    display: grid;
    gap: 2px;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-weight: 600;
  }
  .code-open small {
    color: var(--text-muted);
    font-weight: 400;
  }
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .code-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-3);
    align-items: center;
  }
  .inline {
    display: flex;
    gap: var(--gap-2);
    flex: 1 1 20rem;
    max-width: 28rem;
  }
  .workbench {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: var(--space-4);
    align-items: start;
  }
  .search-row {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr);
    gap: var(--gap-2);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    background: var(--surface-2);
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
  .event-list,
  .match-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
    max-height: 32rem;
    overflow-y: auto;
  }
  .event-list button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid transparent;
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    cursor: pointer;
  }
  .event-list button:hover {
    border-color: var(--brand-gold-strong);
  }
  .event-list span,
  .event-head span,
  .t-match header span {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .event-head {
    display: grid;
    gap: var(--space-2);
  }
  .event-head > div {
    display: grid;
  }
  .link {
    justify-self: start;
    border: 0;
    background: none;
    color: var(--brand-gold-strong);
    cursor: pointer;
    padding: 0;
    font-size: 0.85rem;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-2);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
  }
  .seg button {
    padding: 0.4rem 0.8rem;
    border: 0;
    background: var(--surface-2);
    color: var(--text-muted);
    cursor: pointer;
  }
  .seg button.on {
    background: var(--brand-gold-soft);
    color: var(--text);
    font-weight: 600;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
    color: var(--text-muted);
  }
  .match-list li {
    display: grid;
    grid-template-columns: minmax(7rem, 1fr) minmax(0, 1.4fr) auto auto;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--space-2);
    background: var(--surface-2);
    border: 1px solid transparent;
  }
  .match-list li.highlight {
    border-color: var(--brand-gold-strong);
    background: var(--brand-gold-soft);
  }
  .match-list li.muted {
    display: block;
    background: none;
  }
  .m-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .m-label a {
    color: var(--text-muted);
    display: inline-flex;
  }
  .m-teams {
    display: grid;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .m-teams .red {
    color: var(--red-strong);
  }
  .m-teams .blue {
    color: var(--blue-strong);
  }
  .m-score {
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .added {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--green-strong);
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .match-list .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .pool {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px dashed var(--border);
  }
  .pool-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gap-2);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .chip {
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .t-match {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-2);
  }
  .t-match header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--gap-2);
  }
  .t-match header > div:first-child {
    display: grid;
  }
  .t-actions {
    display: flex;
    gap: 0.35rem;
  }
  .t-actions .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .slots {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-2);
  }
  .alliance {
    display: grid;
    gap: 0.35rem;
    padding-left: var(--space-2);
    border-left: 3px solid;
  }
  .alliance.red {
    border-color: var(--red-base);
  }
  .alliance.blue {
    border-color: var(--blue-base);
  }
  .slot {
    display: grid;
    grid-template-columns: 3.6rem minmax(0, 1fr);
    align-items: center;
    gap: 0.4rem;
  }
  .slot .team {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .slot .team :global(svg) {
    color: var(--green-strong);
  }
  .empty {
    margin: 0;
    padding: var(--space-4);
    border: 1px dashed var(--border);
    color: var(--text-muted);
    text-align: center;
    font-size: 0.88rem;
  }
  @media (max-width: 1000px) {
    .workbench {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 560px) {
    .slots {
      grid-template-columns: 1fr;
    }
    .match-list li {
      grid-template-columns: 1fr auto;
    }
    .m-teams {
      grid-column: 1 / -1;
    }
    .search-row {
      grid-template-columns: 1fr;
    }
  }
</style>

<script>
  import { suggest } from '$lib/ui/suggest.js';
  import Select from '$lib/components/common/Select.svelte';
  import { onMount } from 'svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { userStore } from '$lib/stores/auth.js';
  import { fetchActiveScoutingEventKey, fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';
  import { isPhone } from '$lib/stores/device.js';
  let user;
  userStore.subscribe((v) => (user = v));

  let matches = [];
  let noteText = '';
  let rankingImpact = 0;
  let selectedMatch = null;
  let selectedMatchKey = '';
  let selectedTeam = '';
  let eventTeams = [];
  let manualMatchLabel = '';
  let manualTeamInput = '';
  let viewMode = 'editor'; // 'editor' or 'view-notes'
  // Phones show the editor or the notes, one at a time.
  let phoneTab = 'write';
  const IMPACTS = [
    [-2, 'Major concern'],
    [-1, 'Concern'],
    [0, 'Observation'],
    [1, 'Positive'],
    [2, 'Standout']
  ];
  let teams = [];
  let teamsWithNotes = [];
  let selectedTeamWithNotes = '';
  let teamNotes = [];
  let saving = false;
  let apiNote = '';
  let eventKey = ''; // globally active scouting event
  let selectedEventKey = null; // event being browsed, if different from active
  let availableEvents = [];
  let lastLoadedMatchesEventKey = null;

  // Every downstream fetch (TBA matches, manual match keys) should use this,
  // not the raw active eventKey - blank selectedEventKey means "track
  // whatever event is currently active."
  $: resolvedEventKey = selectedEventKey || eventKey;
  $: isViewingPastEvent = !!selectedEventKey && selectedEventKey !== eventKey;

  function displayTeam(t) {
    if (!t) return '';
    return String(t).replace(/^frc/i, '');
  }

  function normalizeTeamKey(value) {
    const raw = String(value || '')
      .trim()
      .toLowerCase();
    if (!raw) return '';
    if (raw.startsWith('frc')) return raw;
    const digits = raw.replace(/\D/g, '');
    return digits ? `frc${digits}` : raw;
  }

  function slugifyMatchLabel(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function buildManualMatch(label) {
    const trimmed = String(label || '').trim();
    const slug = slugifyMatchLabel(trimmed);
    if (!trimmed || !slug) return null;
    const numeric = parseInt(trimmed.replace(/\D/g, ''), 10);
    return {
      match_key: `${resolvedEventKey || 'manual'}_manual_${slug}`,
      match_number: Number.isFinite(numeric) ? numeric : null,
      manual_label: trimmed,
      manual: true,
      red_team_keys: [],
      blue_team_keys: []
    };
  }

  function formatMatchLabel(match) {
    if (!match) return '';
    if (match.manual_label) return match.manual_label;
    const level = String(match.comp_level || '').toLowerCase();
    const setNumber = Number(match.set_number) || 1;
    const matchNumber = Number(match.match_number) || 0;
    if (level === 'pm') return `Practice ${matchNumber}`;
    if (level === 'qm') return `Qual ${matchNumber}`;
    if (level === 'ef') return `Eighthfinal ${setNumber}-${matchNumber}`;
    if (level === 'qf') return `Quarterfinal ${setNumber}-${matchNumber}`;
    if (level === 'sf') return `Semifinal ${setNumber}-${matchNumber}`;
    if (level === 'f') return `Final ${matchNumber}`;
    return match.match_key?.split('_').pop() || match.key?.split('_').pop() || '';
  }

  // Load event matches via server proxy to The Blue Alliance
  async function loadMatches() {
    apiNote = '';
    if (!resolvedEventKey) {
      apiNote = 'No event configured for Note Scouting.';
      matches = [];
      return;
    }
    try {
      const res = await fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(resolvedEventKey)}`);
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        const text = await res.text();
        apiNote = 'Non-JSON response from server (status ' + res.status + '): ' + text.slice(0, 120);
        matches = [];
        return;
      }
      if (!data?.success) {
        apiNote = data?.error || 'Failed to load matches';
        matches = [];
        return;
      }
      matches = (data.data || []).map((m) => ({
        match_key: m.key,
        match_number: m.match_number,
        comp_level: m.comp_level,
        set_number: m.set_number,
        red_team_keys: m.alliances?.red?.team_keys || [],
        blue_team_keys: m.alliances?.blue?.team_keys || []
      }));
      eventTeams = [...new Set(matches.flatMap((m) => [...(m.red_team_keys || []), ...(m.blue_team_keys || [])]))].sort(
        (a, b) => {
          const numA = parseInt(String(a).replace(/\D/g, '')) || 0;
          const numB = parseInt(String(b).replace(/\D/g, '')) || 0;
          return numA - numB;
        }
      );
    } catch (e) {
      apiNote = e.message || 'Failed to load matches';
      matches = [];
    }
  }

  function onSelectMatch(m) {
    selectedMatch = m || null;
    selectedMatchKey = m?.match_key || '';
    teams = m ? [...(m.red_team_keys || []), ...(m.blue_team_keys || [])] : [];
    // convert team keys (e.g. "frc254") to team numbers if needed
    selectedTeam = teams[0] || '';
  }

  function onSelectMatchByKey() {
    if (selectedMatchKey === '__manual__') {
      selectedMatch = buildManualMatch(manualMatchLabel);
      teams = [];
      selectedTeam = normalizeTeamKey(manualTeamInput);
      return;
    }
    const m = matches.find((x) => x.match_key === selectedMatchKey);
    onSelectMatch(m);
  }

  $: if (selectedMatchKey === '__manual__') {
    selectedMatch = buildManualMatch(manualMatchLabel);
    teams = [];
    selectedTeam = normalizeTeamKey(manualTeamInput);
  }

  // Load list of teams that have notes
  async function loadTeamsWithNotes() {
    if (!resolvedEventKey) {
      teamsWithNotes = [];
      selectedTeamWithNotes = '';
      return;
    }
    try {
      const res = await authFetch(`/notescout?list_teams=1&event_key=${encodeURIComponent(resolvedEventKey)}`);
      const data = await res.json();
      if (data?.success) {
        teamsWithNotes = data.data || [];
        selectedTeamWithNotes = teamsWithNotes[0] || '';
      }
    } catch (e) {
      // ignore
    }
  }

  async function viewNotesForSelectedTeam() {
    if (!selectedTeamWithNotes) return;
    apiNote = '';
    try {
      const eventParam = resolvedEventKey ? `&event_key=${encodeURIComponent(resolvedEventKey)}` : '';
      const res = await authFetch(`/notescout?team_key=${encodeURIComponent(selectedTeamWithNotes)}${eventParam}`);
      const data = await res.json();
      if (!data?.success) {
        apiNote = data?.error || 'Failed to load notes';
        teamNotes = [];
        return;
      }
      teamNotes = data.data || [];
      viewMode = 'view-notes';
    } catch (e) {
      apiNote = e.message || 'Failed to load notes';
    }
  }

  // --- assignment (scouting_type: 'note') ---
  let myNoteAssignments = {};

  function assignmentLookupKey(matchKey, teamKey) {
    return `${matchKey}::${teamKey}`;
  }

  function isMyAssignedRobot(matchKey, teamKey) {
    return !!myNoteAssignments[assignmentLookupKey(matchKey, teamKey)];
  }

  async function loadMyAssignments() {
    if (!user?.id) {
      myNoteAssignments = {};
      return;
    }
    try {
      const res = await authFetch(
        `/api/scout-assignments?scouting_type=note&mine=1&user_id=${encodeURIComponent(user.id)}`
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed');
      const next = {};
      for (const row of data.data || []) {
        if (row?.completed_at) continue;
        next[assignmentLookupKey(row.match_key, row.team_key)] = true;
      }
      myNoteAssignments = next;
    } catch {
      myNoteAssignments = {};
    }
  }

  async function completeMyAssignment(matchKey, teamKey) {
    if (!user?.id || !isMyAssignedRobot(matchKey, teamKey)) return;
    try {
      await authFetch('/api/scout-assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          scouting_type: 'note',
          match_key: matchKey,
          team_key: teamKey,
          user_id: user.id
        })
      });
      await loadMyAssignments();
    } catch {
      // scouted data already saved - a failed "mark complete" isn't worth blocking on
    }
  }

  async function saveNote() {
    if (!selectedMatch || !selectedTeam) return;
    saving = true;
    try {
      const payload = {
        action: 'save-note',
        match_key: selectedMatch.match_key,
        match_number: selectedMatch.match_number,
        team_key: selectedTeam,
        notes: noteText || '',
        ranking_impact: rankingImpact
      };
      const res = await authFetch('/notescout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data?.success) {
        alert('Save failed: ' + (data?.error || 'unknown'));
      } else {
        noteText = '';
        rankingImpact = 0;
        alert(data.warning || 'Saved');
        void completeMyAssignment(selectedMatch.match_key, selectedTeam);
      }
    } catch (e) {
      alert('Save error: ' + e.message);
    } finally {
      saving = false;
    }
  }

  async function loadEventOptions() {
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    availableEvents = await fetchAvailableScoutingEvents();
  }

  onMount(() => {
    loadEventOptions();
    loadTeamsWithNotes();
    loadMyAssignments();
  });

  // Re-fetch matches whenever the resolved event changes - covers both the
  // initial async load of the active event key and the user switching the
  // event dropdown afterward.
  $: {
    if (resolvedEventKey !== lastLoadedMatchesEventKey) {
      lastLoadedMatchesEventKey = resolvedEventKey;
      loadMatches();
      loadTeamsWithNotes();
    }
  }
</script>

<div class="page-header card">
  <div>
    <h2 style="margin:0">Note Scouting</h2>
    {#if resolvedEventKey}
      <div class="form-label" style="margin-top:0.25rem">Event: {resolvedEventKey}</div>
    {/if}
    {#if apiNote}
      <div class="note" style="margin-top:0.5rem">{apiNote}</div>
    {/if}
    {#if isViewingPastEvent}
      <div class="note" style="margin-top:0.5rem">
        Viewing past event {selectedEventKey}, not the active event ({eventKey || 'none set'}). Notes saved here will be
        saved under {selectedEventKey} too — switch back to "Current Event" before scouting a live match.
      </div>
    {/if}
  </div>

  <div class="page-actions with-select">
    <SeasonFilter
      options={availableEvents}
      bind:value={selectedEventKey}
      allLabel={`Current Event (${eventKey || 'none set'})`}
    />
    <div class="form-group" style="min-width:220px">
      <label class="form-label" for="matchSelect">Match</label>
      <Select class="form-select" id="matchSelect" bind:value={selectedMatchKey} on:change={onSelectMatchByKey}>
        <option value="">-- choose match --</option>
        <option value="__manual__">Manual / Unofficial Match</option>
        {#each matches as m}
          {#key m.match_key}
            <option value={m.match_key}>{formatMatchLabel(m)}</option>
          {/key}
        {/each}
      </Select>
    </div>

    <div class="form-group notes-for" style="min-width:200px">
      <label class="form-label" for="notesTeamSelect">View notes for</label>
      <div class="with-select" style="display:flex; gap:0.5rem">
        <Select class="form-select" id="notesTeamSelect" bind:value={selectedTeamWithNotes}>
          <option value="">-- choose team --</option>
          {#each teamsWithNotes as t}
            <option value={t}>{displayTeam(t)}</option>
          {/each}
        </Select>
        <button class="btn btn-secondary" on:click={viewNotesForSelectedTeam} disabled={!selectedTeamWithNotes}
          >View</button
        >
      </div>
    </div>
  </div>
</div>

{#if $isPhone}
  <div class="ph-seg" role="tablist" aria-label="Notes">
    <button
      role="tab"
      aria-selected={phoneTab === 'write'}
      class:on={phoneTab === 'write'}
      on:click={() => (phoneTab = 'write')}>Write</button
    >
    <button
      role="tab"
      aria-selected={phoneTab === 'read'}
      class:on={phoneTab === 'read'}
      on:click={() => (phoneTab = 'read')}>Read notes</button
    >
  </div>
{/if}
<div
  class="grid grid-2"
  class:ph-write={$isPhone && phoneTab === 'write'}
  class:ph-read={$isPhone && phoneTab === 'read'}
>
  <div class="card">
    <h3 style="margin-top:0">Scouting Editor</h3>
    {#if selectedMatchKey === '__manual__'}
      <div class="manual-entry-grid">
        <div class="form-group">
          <label class="form-label" for="manualMatchLabel">Manual Match Label</label>
          <input id="manualMatchLabel" class="form-input" bind:value={manualMatchLabel} placeholder="Practice 1" />
        </div>
        <div class="form-group">
          <label class="form-label" for="manualTeamInput">Team</label>
          <input
            id="manualTeamInput"
            class="form-input"
            bind:value={manualTeamInput}
            list="note-event-team-options"
            use:suggest
            placeholder="254 or frc254"
          />
          <datalist id="note-event-team-options">
            {#each eventTeams as t}
              <option value={displayTeam(t)}></option>
              <option value={t}></option>
            {/each}
          </datalist>
        </div>
      </div>
    {/if}

    {#if selectedMatch}
      <div class="form-group">
        <div class="form-label">Match</div>
        <div><strong>{formatMatchLabel(selectedMatch)}</strong></div>
      </div>

      <div class="form-group">
        <label class="form-label" for="teamSelect">Team</label>
        {#if selectedMatchKey === '__manual__'}
          <input
            id="teamSelect"
            class="form-input"
            bind:value={manualTeamInput}
            list="note-event-team-options"
            use:suggest
            placeholder="254 or frc254"
          />
        {:else}
          <Select id="teamSelect" class="form-select" bind:value={selectedTeam}>
            {#each teams as t}
              <option value={t}>{displayTeam(t)}</option>
            {/each}
          </Select>
        {/if}
      </div>

      <div class="form-group">
        <label class="form-label" for="notesArea">Notes</label>
        <textarea
          id="notesArea"
          class="form-input"
          rows="10"
          bind:value={noteText}
          placeholder="Enter scouting notes here (plain text)."
        ></textarea>
      </div>

      <div class="form-group">
        <label class="form-label" for="rankingImpact">Ranking impact</label>
        {#if $isPhone}
          <div class="ph-impact" role="radiogroup" aria-label="Ranking impact">
            {#each IMPACTS as [value, label]}
              <button
                type="button"
                role="radio"
                aria-checked={Number(rankingImpact) === value}
                class:on={Number(rankingImpact) === value}
                class:neg={value < 0}
                class:pos={value > 0}
                on:click={() => (rankingImpact = value)}>{label}</button
              >
            {/each}
          </div>
        {:else}
          <Select id="rankingImpact" class="form-select" bind:value={rankingImpact}>
            <option value={-2}>Major concern</option>
            <option value={-1}>Concern</option>
            <option value={0}>Observation only</option>
            <option value={1}>Positive</option>
            <option value={2}>Standout</option>
          </Select>
        {/if}
        <small class="form-help"
          >This structured rating affects Scout Power. The note text remains for human review.</small
        >
      </div>

      <div class="page-actions note-actions">
        <button
          class="btn btn-primary"
          on:click={saveNote}
          disabled={saving || !selectedTeam || !selectedMatch?.match_key}>Save</button
        >
        <button
          class="btn btn-outline"
          on:click={() => {
            noteText = '';
          }}
          disabled={!noteText}>Clear</button
        >
      </div>
    {:else}
      <div class="empty">
        {selectedMatchKey === '__manual__'
          ? 'Enter a manual match label and team to start.'
          : 'Select a match to start'}
      </div>
    {/if}
  </div>

  <div class="card">
    <h3 style="margin-top:0">Notes Viewer</h3>
    {#if $isPhone}
      <div class="ph-notes-for">
        <Select class="form-select" bind:value={selectedTeamWithNotes} aria-label="Team">
          <option value="">Choose a team</option>
          {#each teamsWithNotes as t}<option value={t}>{displayTeam(t)}</option>{/each}
        </Select>
        <button class="btn btn-secondary" on:click={viewNotesForSelectedTeam} disabled={!selectedTeamWithNotes}
          >View</button
        >
      </div>
    {/if}
    {#if viewMode === 'view-notes'}
      <div style="margin-bottom:0.5rem">
        <button
          class="btn btn-secondary"
          on:click={() => {
            viewMode = 'editor';
          }}>Back</button
        >
      </div>
      {#if teamNotes.length === 0}
        <div class="empty">No notes for {displayTeam(selectedTeamWithNotes)}</div>
      {/if}
      <div>
        {#each teamNotes as n}
          <div style="border-bottom:1px solid var(--border); padding:0.75rem 0">
            <div style="font-size:0.9rem; color:var(--secondary); font-weight:700">
              {n.match_number ? ' #' + n.match_number : ''}
            </div>
            <div
              class="impact-badge"
              class:negative={Number(n.ranking_impact) < 0}
              class:positive={Number(n.ranking_impact) > 0}
            >
              Ranking impact: {Number(n.ranking_impact) > 0 ? '+' : ''}{Number(n.ranking_impact) || 0}
            </div>
            <div style="white-space:pre-wrap; margin-top:0.25rem">{n.notes}</div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">Select a team above and click View to see notes, or save notes for the selected match.</div>
    {/if}
  </div>
</div>

<style>
  /* Uses global .empty */
  .manual-entry-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--gap-3);
  }

  .impact-badge {
    display: inline-block;
    margin-top: var(--space-1);
    padding: 0.15rem 0.4rem;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .impact-badge.negative {
    color: var(--red-strong);
    background: var(--red-soft);
  }
  .impact-badge.positive {
    color: var(--success);
  }

  /* Mobile Responsive Styles */
  @media (max-width: 768px) {
    .page-header.card {
      flex-direction: column;
      gap: var(--gap-3);
    }

    .page-actions {
      flex-direction: column;
      width: 100%;
    }

    .page-actions .form-group {
      min-width: unset !important;
      width: 100%;
    }

    .grid.grid-2 {
      grid-template-columns: 1fr;
    }

    :global(.form-input[rows]),
    textarea.form-input {
      min-height: 150px;
    }
  }

  @media (max-width: 480px) {
    .page-header h2 {
      font-size: 1.25rem;
    }

    .page-actions {
      gap: var(--gap-2);
    }

    .page-actions .form-group div {
      flex-direction: column;
      gap: var(--gap-2) !important;
    }

    .page-actions .form-group div .btn {
      width: 100%;
    }
  }

  /* Phone (#124) */
  .grid-2.ph-write > .card:nth-child(2),
  .grid-2.ph-read > .card:nth-child(1) {
    display: none;
  }
  .ph-seg {
    display: grid;
    grid-template-columns: 1fr 1fr;
    margin-bottom: var(--space-3);
    padding: 4px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .ph-seg button {
    min-height: var(--tap-min);
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
  }
  .ph-seg button.on {
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--shadow-raised);
  }
  .ph-impact {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 4px;
  }
  .ph-impact button {
    min-height: var(--tap-comfort);
    padding: 4px 2px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-1);
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.15;
  }
  .ph-impact button.on {
    border-color: var(--accent);
    background: var(--accent-subtle);
    color: var(--text);
  }
  .ph-impact button.on.neg {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .ph-impact button.on.pos {
    border-color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }
  .ph-notes-for {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  @media (max-width: 900px) {
    .notes-for {
      display: none;
    }
    .note-actions {
      position: sticky;
      bottom: calc(var(--dock-height) + var(--space-2));
      z-index: 4;
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: var(--space-2);
      padding: var(--space-2);
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--surface-1) 96%, transparent);
      backdrop-filter: blur(8px);
    }
    .note-actions .btn {
      min-height: var(--tap-comfort);
      justify-content: center;
    }
  }
</style>

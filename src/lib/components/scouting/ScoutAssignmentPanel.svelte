<script>
  import Select from '$lib/components/common/Select.svelte';
  import { zoomed } from '$lib/ui/zoom.js';
  import { onMount } from 'svelte';
  import { scoutDisplayName } from '$lib/scouting/scoutNames.js';
  import { requestConfirmation } from '$lib/app/confirmation.js';
  import { userStore } from '$lib/stores/auth.js';
  import { authFetch } from '$lib/app/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scouting/scoutingEvent.js';
  import {
    autoFill,
    conflictsFor,
    matchLoad,
    ownership,
    parseTeamInput,
    teamMatchMap
  } from '$lib/scouting/assignmentPlanner.js';
  import { KIND_LABELS } from '$lib/scouting/myAssignments.js';

  let user;
  userStore.subscribe((v) => (user = v));

  export let scoutingType = 'data'; // 'data' | 'note' | 'quick'
  export let open = false;

  let matches = []; // { key, red:[], blue:[] }
  let eventKey = '';
  let publishedAssignments = {}; // match_key -> team_key -> { user_id, user_name }
  let assignments = {}; // match_key -> team_key -> { user_id, user_name }
  let users = []; // eligible assignees
  let loading = false;
  let saving = false;
  let errorMsg = '';
  let statusMsg = '';
  let hasDraftChanges = false;

  let capabilities = {
    can_view: true,
    can_edit: false,
    can_be_assigned: false,
    roster_keys: []
  };

  let showModal = false;
  let modalContext = { match_key: '', team_key: '', team_number: '' };
  let selectedUserId = '';
  let lastUserId = null;
  let draggingTeamKey = '';
  let dropTargetUserId = '';
  let dragClientX = 0;
  let dragClientY = 0;
  let scoutFilter = '';
  let selectedTeams = [];
  let poolSearch = '';
  // False until the first full load (permissions, schedule, assignments, scouts) has finished,
  // so the board never shows its half-loaded states.
  let ready = false;
  let statusFilter = 'all';
  let kindFilter = 'all';
  let sortBy = 'name';
  let addDrafts = {};

  function displayTeam(teamKey) {
    return teamKey ? String(teamKey).replace(/^frc/i, '') : '';
  }

  function cloneAssignments(map) {
    const next = {};
    for (const [matchKey, teamMap] of Object.entries(map || {})) {
      next[matchKey] = {};
      for (const [teamKey, value] of Object.entries(teamMap || {})) {
        next[matchKey][teamKey] = { ...value };
      }
    }
    return next;
  }

  function serializeAssignments(map) {
    return Object.entries(map || {})
      .flatMap(([matchKey, teamMap]) =>
        Object.entries(teamMap || {}).map(([teamKey, value]) => `${matchKey}::${teamKey}::${value?.user_id || ''}`)
      )
      .sort()
      .join('|');
  }

  function findUserName(userId) {
    const matched = users.find((userRow) => userRow.id === userId);
    return matched ? scoutDisplayName(matched) : null;
  }

  function stageAssignments(nextAssignments, message) {
    assignments = cloneAssignments(nextAssignments);
    statusMsg = message || '';
    errorMsg = '';
  }

  function stageSingleAssignment(matchKey, teamKey, userId) {
    const nextAssignments = cloneAssignments(assignments);
    if (!nextAssignments[matchKey]) nextAssignments[matchKey] = {};
    nextAssignments[matchKey][teamKey] = {
      user_id: userId,
      user_name: findUserName(userId) || assignments?.[matchKey]?.[teamKey]?.user_name || null
    };
    stageAssignments(nextAssignments, 'Assignment drafts are staged locally. Publish when the assignments are ready.');
  }

  // Give one or more whole robots to a scout in a single staged change (nothing is sent until Publish).
  function stageTeamsFor(userId, teamKeys) {
    if (!userId || !capabilities.can_edit) return;
    const known = teamKeys.filter((team) => matchMap.has(team));
    const unknown = teamKeys.filter((team) => !matchMap.has(team));
    if (!known.length) {
      errorMsg = unknown.length
        ? `${unknown.map(displayTeam).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the match schedule.`
        : '';
      return;
    }
    const next = cloneAssignments(assignments);
    const name = findUserName(userId) || null;
    let matchCount = 0;
    for (const team of known) {
      for (const matchKey of matchMap.get(team)) {
        if (!next[matchKey]) next[matchKey] = {};
        next[matchKey][team] = { user_id: userId, user_name: name };
        matchCount += 1;
      }
    }
    const moved = known.filter((team) => owners.get(team)?.userId && owners.get(team).userId !== userId).length;
    stageAssignments(
      next,
      `${known.length} team${known.length === 1 ? '' : 's'} staged for ${name || 'that scout'} (${matchCount} matches)${moved ? `, ${moved} moved from another scout` : ''}. Publish when ready.`
    );
    if (unknown.length)
      errorMsg = `${unknown.map(displayTeam).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the match schedule.`;
    selectedTeams = selectedTeams.filter((team) => !known.includes(team));
  }

  function toggleSelect(teamKey) {
    selectedTeams = selectedTeams.includes(teamKey)
      ? selectedTeams.filter((team) => team !== teamKey)
      : [...selectedTeams, teamKey];
  }

  function submitAdd(userId) {
    const keys = parseTeamInput(addDrafts[userId]);
    if (!keys.length) return;
    addDrafts = { ...addDrafts, [userId]: '' };
    stageTeamsFor(userId, keys);
  }

  function autoFillUnassigned() {
    if (!capabilities.can_edit || !unassignedTeams.length || !users.length) return;
    const held = new Map(users.map((scout) => [scout.id, teamsByScout.get(scout.id) || []]));
    const { plan, clashes } = autoFill({ teams: unassignedTeams, scouts: users, held, matchMap });
    const next = cloneAssignments(assignments);
    for (const [team, userId] of plan) {
      const name = findUserName(userId) || null;
      for (const matchKey of matchMap.get(team) || []) {
        if (!next[matchKey]) next[matchKey] = {};
        next[matchKey][team] = { user_id: userId, user_name: name };
      }
    }
    stageAssignments(
      next,
      `Spread ${plan.size} unassigned team${plan.size === 1 ? '' : 's'} across ${users.length} scouts${clashes ? `; ${clashes} could not avoid asking a scout to watch two robots in one match` : ', with no scout asked to watch two robots at once'}. Publish when ready.`
    );
  }

  function startTeamDrag(event, teamKey) {
    if (!capabilities.can_edit || !teamKey) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    draggingTeamKey = teamKey;
    dragClientX = event.clientX;
    dragClientY = event.clientY;
  }

  function updateTeamDrag(event) {
    if (!draggingTeamKey) return;
    dragClientX = event.clientX;
    dragClientY = event.clientY;
    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const zone = hovered?.closest?.('[data-scout-drop-user]');
    dropTargetUserId = zone?.dataset?.scoutDropUser || '';
  }

  function finishTeamDrag() {
    draggingTeamKey = '';
    dropTargetUserId = '';
  }

  function finishPointerTeamDrag(event) {
    if (!draggingTeamKey) return;
    updateTeamDrag(event);
    if (dropTargetUserId)
      stageTeamsFor(dropTargetUserId, selectedSet.has(draggingTeamKey) ? selectedTeams : [draggingTeamKey]);
    finishTeamDrag();
  }

  async function loadCapabilities() {
    try {
      const qs = new URLSearchParams({ scouting_type: scoutingType, capabilities: '1' });
      const res = await authFetch(`/api/scout-assignments?${qs}`);
      const data = await res.json();
      if (data?.success && data?.data) {
        capabilities = { ...capabilities, ...data.data };
      }
    } catch {
      capabilities = { ...capabilities, can_edit: false };
    }
  }

  // Fired alongside the other loads: the server answers 403 when the viewer cannot edit,
  // so there is no need to wait for the capabilities call first.
  async function loadEligibleUsers() {
    try {
      const qs = new URLSearchParams({ scouting_type: scoutingType, eligible: '1' });
      const res = await authFetch(`/api/scout-assignments?${qs}`);
      const data = await res.json();
      users = data?.success ? data.data || [] : [];
    } catch {
      users = [];
    }
  }

  async function loadMatches() {
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    if (!eventKey) {
      errorMsg = 'No event configured';
      return;
    }

    try {
      loading = true;
      errorMsg = '';
      const res = await fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(eventKey)}&comp_level=qm`);

      let data;
      try {
        data = await res.json();
      } catch {
        const text = await res.text();
        errorMsg = `Non-JSON response (${res.status}): ${text.slice(0, 100)}`;
        return;
      }

      if (!data?.success) {
        errorMsg = data?.error || 'Failed to load matches';
        return;
      }

      matches = (data.data || []).map((m) => ({
        key: m.key,
        match_number: m.match_number,
        red: m.alliances?.red?.team_keys || [],
        blue: m.alliances?.blue?.team_keys || []
      }));
    } catch (e) {
      errorMsg = e.message || 'Load error';
    } finally {
      loading = false;
    }
  }

  async function loadAssignments() {
    try {
      const qs = new URLSearchParams({ scouting_type: scoutingType });
      const res = await authFetch(`/api/scout-assignments?${qs}`);
      const data = await res.json();
      if (!data?.success) return;

      const nextAssignments = {};
      for (const row of data.data || []) {
        if (!nextAssignments[row.match_key]) nextAssignments[row.match_key] = {};
        nextAssignments[row.match_key][row.team_key] = {
          user_id: row.assigned_user,
          user_name: row.user_name
        };
      }
      publishedAssignments = cloneAssignments(nextAssignments);
      assignments = cloneAssignments(nextAssignments);
      statusMsg = '';
    } catch {
      publishedAssignments = {};
      assignments = {};
    }
  }

  function openAssign(match_key, team_key) {
    if (!capabilities.can_edit) return;
    modalContext = { match_key, team_key, team_number: displayTeam(team_key) };
    selectedUserId = assignments?.[match_key]?.[team_key]?.user_id || '';
    showModal = true;
  }

  function saveAssignment(applyToAll = false) {
    if (!selectedUserId || !capabilities.can_edit) return;

    if (applyToAll) {
      const team_key = modalContext.team_key;
      const nextAssignments = cloneAssignments(assignments);
      let foundMatch = false;

      for (const m of matches) {
        if ((m.blue || []).includes(team_key) || (m.red || []).includes(team_key)) {
          if (!nextAssignments[m.key]) nextAssignments[m.key] = {};
          nextAssignments[m.key][team_key] = {
            user_id: selectedUserId,
            user_name: findUserName(selectedUserId) || null
          };
          foundMatch = true;
        }
      }

      if (!foundMatch) {
        alert('No matches found for that robot');
        return;
      }

      stageAssignments(nextAssignments, 'Robot assignment drafts updated. Publish assignments to send notifications.');
      showModal = false;
      return;
    }

    stageSingleAssignment(modalContext.match_key, modalContext.team_key, selectedUserId);
    showModal = false;
  }

  // Unlike saveAssignment (a local draft, only sent on Publish), this is
  // immediate - direct instruction: removing someone should notify them
  // right away, not sit as an unpublished draft they never find out about.
  async function removeAssignment() {
    if (!capabilities.can_edit || saving) return;
    const { match_key, team_key } = modalContext;
    if (!match_key || !team_key) return;
    saving = true;
    errorMsg = '';
    try {
      const res = await authFetch('/api/scout-assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unassign', scouting_type: scoutingType, match_key, team_key })
      });
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'unknown');
      await loadAssignments();
      statusMsg = `Team ${modalContext.team_number} unassigned.`;
      showModal = false;
    } catch (e) {
      errorMsg = `Remove failed: ${e.message}`;
    } finally {
      saving = false;
    }
  }

  // The x on a team chip in a scout's drop zone unassigns that whole robot
  // (every one of its scheduled matches currently owned by that scout) in
  // one click, instead of opening the per-match modal once per match -
  // same immediate, notify-right-away behaviour as removeAssignment above.
  async function removeRobotAssignment(teamKey) {
    if (!capabilities.can_edit || saving || !teamKey) return;
    const matchKeys = matches
      .filter((match) => match.blue.includes(teamKey) || match.red.includes(teamKey))
      .map((match) => match.key);
    if (!matchKeys.length) return;
    saving = true;
    errorMsg = '';
    try {
      for (const matchKey of matchKeys) {
        const res = await authFetch('/api/scout-assignments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'unassign',
            scouting_type: scoutingType,
            match_key: matchKey,
            team_key: teamKey
          })
        });
        const data = await res.json();
        if (!data?.success) throw new Error(data?.error || 'unknown');
      }
      await loadAssignments();
      statusMsg = `Team ${displayTeam(teamKey)} unassigned.`;
    } catch (e) {
      errorMsg = `Remove failed: ${e.message}`;
    } finally {
      saving = false;
    }
  }

  async function bulkPersist(map) {
    const list = [];
    for (const mk of Object.keys(map || {})) {
      for (const tk of Object.keys(map[mk] || {})) {
        const userId = map[mk][tk]?.user_id;
        if (!userId) continue;
        list.push({ match_key: mk, team_key: tk, user_id: userId });
      }
    }

    if (list.length === 0) {
      statusMsg = 'No assignments to publish.';
      return;
    }

    saving = true;
    try {
      const body = { action: 'bulk-assign', scouting_type: scoutingType, items: list };
      const res = await authFetch('/api/scout-assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!data?.success) {
        throw new Error(data?.error || 'unknown');
      } else {
        await loadAssignments();
        statusMsg = 'Assignments published.';
      }
    } catch (e) {
      errorMsg = `Publish failed: ${e.message}`;
    } finally {
      saving = false;
    }
  }

  async function publishAssignments() {
    if (!capabilities.can_edit || !hasDraftChanges || saving) return;
    errorMsg = '';
    await bulkPersist(assignments);
  }

  async function refreshAll({ force = false } = {}) {
    if (!force && hasDraftChanges) {
      const discard = await requestConfirmation({
        title: 'Discard assignment drafts',
        message: 'Discard unpublished scouting assignment drafts and reload the published assignments?',
        confirmLabel: 'Discard drafts',
        danger: true
      });
      if (!discard) return;
    }

    await Promise.all([loadCapabilities(), loadMatches(), loadAssignments(), loadEligibleUsers()]);
    ready = true;
  }

  onMount(() => {
    refreshAll({ force: true });
  });

  $: if (user?.id && user.id !== lastUserId) {
    lastUserId = user.id;
    refreshAll({ force: true });
  }

  $: hasDraftChanges = serializeAssignments(assignments) !== serializeAssignments(publishedAssignments);
  $: scheduledTeamKeys = [...new Set(matches.flatMap((match) => [...match.blue, ...match.red]))].sort(
    (a, b) => Number(displayTeam(a)) - Number(displayTeam(b))
  );
  $: matchMap = teamMatchMap(matches);
  $: owners = ownership(assignments, matches);
  $: publishedOwners = ownership(publishedAssignments, matches);
  $: unassignedTeams = scheduledTeamKeys.filter((team) => !owners.get(team)?.userId);
  $: partialTeams = scheduledTeamKeys.filter((team) => owners.get(team)?.partial);
  $: teamsByScout = users.reduce((map, scout) => {
    map.set(
      scout.id,
      scheduledTeamKeys.filter((team) => owners.get(team)?.userId === scout.id)
    );
    return map;
  }, new Map());
  $: poolQuery = poolSearch.replace(/\D/g, '');
  $: shownUnassigned = poolQuery
    ? unassignedTeams.filter((team) => displayTeam(team).includes(poolQuery))
    : unassignedTeams;
  $: coveredCount = scheduledTeamKeys.length - unassignedTeams.length;
  $: busiest = Math.max(1, ...users.map((scout) => matchLoad(teamsByScout.get(scout.id), matchMap)));
  $: selectedSet = new Set(selectedTeams);
  const isDraft = (team) => (owners.get(team)?.userId || '') !== (publishedOwners.get(team)?.userId || '');
  const clashesOf = (scout) => conflictsFor(teamsByScout.get(scout.id) || [], matchMap);
  $: scoutInfo = users.reduce((map, scout) => {
    const teams = teamsByScout.get(scout.id) || [];
    map.set(scout.id, {
      teams,
      load: matchLoad(teams, matchMap),
      clashes: conflictsFor(teams, matchMap).length,
      draft: teams.some((team) => isDraft(team))
    });
    return map;
  }, new Map());
  $: statusCounts = users.reduce(
    (counts, scout) => {
      const info = scoutInfo.get(scout.id);
      counts.all += 1;
      if (info.teams.length) counts.busy += 1;
      else counts.free += 1;
      if (info.clashes) counts.clash += 1;
      if (info.draft) counts.draft += 1;
      return counts;
    },
    { all: 0, free: 0, busy: 0, clash: 0, draft: 0 }
  );
  // The search matches a name or email, or a team number a scout holds (typing a team number finds who has it).
  // Match assignments become Data, Performance or Robot scouting from each scout's role on the People tab.
  $: showKinds = scoutingType === 'data';
  $: kindByUser = new Map(users.map((scout) => [scout.id, scout.report_kind || 'data']));
  $: kindCounts = users.reduce(
    (counts, scout) => ({ ...counts, [kindByUser.get(scout.id)]: (counts[kindByUser.get(scout.id)] || 0) + 1 }),
    {}
  );
  const kindShort = (kind) => ({ data: 'D', performance: 'P', robot: 'R' })[kind] || 'D';
  $: filteredUsers = users
    .filter((scout) => {
      const info = scoutInfo.get(scout.id);
      if (showKinds && kindFilter !== 'all' && kindByUser.get(scout.id) !== kindFilter) return false;
      if (statusFilter === 'free' && info.teams.length) return false;
      if (statusFilter === 'busy' && !info.teams.length) return false;
      if (statusFilter === 'clash' && !info.clashes) return false;
      if (statusFilter === 'draft' && !info.draft) return false;
      const query = scoutFilter.trim().toLowerCase();
      if (!query) return true;
      const digits = query.replace(/\D/g, '');
      const text = `${scout.full_name || ''} ${scout.email || ''}`.toLowerCase();
      return text.includes(query) || (digits && info.teams.some((team) => displayTeam(team).startsWith(digits)));
    })
    .sort((a, b) => {
      const la = scoutInfo.get(a.id).load;
      const lb = scoutInfo.get(b.id).load;
      if (sortBy === 'most' && la !== lb) return lb - la;
      if (sortBy === 'least' && la !== lb) return la - lb;
      return scoutDisplayName(a).localeCompare(scoutDisplayName(b));
    });
</script>

<svelte:window on:pointermove={updateTeamDrag} on:pointerup={finishPointerTeamDrag} on:pointercancel={finishTeamDrag} />

{#if open}
  <section class="board" aria-label="Scout assignments">
    <header class="head">
      <div>
        <h3>{scoutingType === 'note' ? 'Note' : scoutingType === 'quick' ? 'Quick' : 'Match'} scouting assignments</h3>
        <p class="sub">
          {#if !ready}Loading...
          {:else if !scheduledTeamKeys.length}No schedule loaded for this event yet.
          {:else}{coveredCount} of {scheduledTeamKeys.length} teams assigned{#if partialTeams.length}
              · {partialTeams.length} partly{/if}{/if}
        </p>
      </div>
      <div class="head-actions">
        {#if ready && capabilities.can_edit}
          <button
            class="btn btn-outline btn-sm"
            on:click={autoFillUnassigned}
            disabled={!unassignedTeams.length || !users.length || saving}
            title="Give each unassigned team to the scout with the least work, avoiding two robots in one match"
            >Spread unassigned</button
          >
          <button class="btn btn-primary btn-sm" on:click={publishAssignments} disabled={!hasDraftChanges || saving}
            >{saving ? 'Publishing...' : hasDraftChanges ? 'Publish changes' : 'Published'}</button
          >
        {/if}
        <button class="btn btn-outline btn-sm" on:click={() => refreshAll()} disabled={!ready || loading || saving}
          >{hasDraftChanges ? 'Discard' : 'Refresh'}</button
        >
      </div>
    </header>

    {#if errorMsg}<p class="note err" role="alert">{errorMsg}</p>{/if}
    {#if capabilities.can_edit && (statusMsg || hasDraftChanges)}
      <p class="note" class:pending={hasDraftChanges}>
        {statusMsg || 'Changes are staged. Publish to make them live and notify scouts.'}
      </p>
    {/if}

    {#if !ready}
      <div class="skel" aria-busy="true" aria-label="Loading assignments">
        <div class="skel-bar"></div>
        {#each [0, 1, 2, 3, 4, 5] as _row}
          <div class="skel-row">
            <span class="skel-av"></span><span class="skel-line w1"></span><span class="skel-line w2"></span>
          </div>
        {/each}
      </div>
    {:else if capabilities.can_edit}
      <div class="layout">
        <div class="scouts-col">
          <div class="toolbar">
            <input
              class="filter"
              type="search"
              bind:value={scoutFilter}
              placeholder="Find a scout or team"
              aria-label="Find a scout or a team they hold"
            />
            <label class="sort"
              >Show
              <Select bind:value={statusFilter} aria-label="Show scouts">
                <option value="all">All scouts ({statusCounts.all})</option>
                <option value="free">No teams ({statusCounts.free})</option>
                <option value="busy">Has teams ({statusCounts.busy})</option>
                {#if statusCounts.clash}<option value="clash">Clashes ({statusCounts.clash})</option>{/if}
                {#if statusCounts.draft}<option value="draft">Unpublished ({statusCounts.draft})</option>{/if}
              </Select>
            </label>
            {#if showKinds}
              <label class="sort"
                >Role
                <Select bind:value={kindFilter} aria-label="Show scouts by role">
                  <option value="all">Every role</option>
                  {#each Object.keys(KIND_LABELS) as kind}<option value={kind}
                      >{KIND_LABELS[kind]}s ({kindCounts[kind] || 0})</option
                    >{/each}
                </Select>
              </label>
              <span class="kind-key">In the match grid: D Data, P Performance, R Robot scout</span>
            {/if}
            <label class="sort"
              >Sort
              <Select bind:value={sortBy} aria-label="Sort scouts">
                <option value="name">Name</option>
                <option value="least">Least work first</option>
                <option value="most">Most work first</option>
              </Select>
            </label>
          </div>
          <ul class="scout-list">
            {#each filteredUsers as scout (scout.id)}
              {@const mine = teamsByScout.get(scout.id) || []}
              {@const clashes = clashesOf(scout)}
              <li class="scout" class:drop-target={dropTargetUserId === scout.id} data-scout-drop-user={scout.id}>
                <span class="av" aria-hidden="true"
                  >{String(scoutDisplayName(scout) || '?')
                    .trim()
                    .slice(0, 1)
                    .toUpperCase()}</span
                >
                <div class="who">
                  <b>{scoutDisplayName(scout)}</b>
                  {#if showKinds}<span class="kind">{KIND_LABELS[kindByUser.get(scout.id)]}</span>{/if}
                  <small
                    >{mine.length
                      ? `${mine.length} team${mine.length === 1 ? '' : 's'} · ${matchLoad(mine, matchMap)} matches`
                      : 'No teams yet'}</small
                  >
                  <span class="load" aria-hidden="true"
                    ><i style={`width:${(matchLoad(mine, matchMap) / busiest) * 100}%`}></i></span
                  >
                </div>
                <div class="teams">
                  {#each mine as team (team)}
                    <span class="chip" class:draft={isDraft(team)}>
                      <button type="button" class="num" on:pointerdown={(event) => startTeamDrag(event, team)}
                        >{displayTeam(team)}{#if isDraft(team)}<small class="draft-tag">staged</small>{/if}</button
                      >
                      <button
                        type="button"
                        class="x"
                        disabled={saving}
                        aria-label={`Unassign team ${displayTeam(team)} from ${scoutDisplayName(scout)}`}
                        title="Unassign (notifies the scout)"
                        on:click={() => removeRobotAssignment(team)}>&times;</button
                      >
                    </span>
                  {/each}
                  <input
                    class="add"
                    placeholder="Add team"
                    inputmode="numeric"
                    aria-label={`Add teams for ${scoutDisplayName(scout)}`}
                    bind:value={addDrafts[scout.id]}
                    on:keydown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submitAdd(scout.id);
                      }
                    }}
                  />
                  {#if selectedTeams.length}
                    <button type="button" class="take" on:click={() => stageTeamsFor(scout.id, selectedTeams)}
                      >Assign {selectedTeams.length} selected</button
                    >
                  {/if}
                </div>
                {#if clashes.length}
                  <p class="clash">
                    Plays at the same time: {clashes
                      .map(
                        (c) =>
                          `${displayTeam(c.a)} + ${displayTeam(c.b)} (${c.matches.map((k) => k.split('_').pop()).join(', ')})`
                      )
                      .join('; ')}
                  </p>
                {/if}
              </li>
            {/each}
            {#if !filteredUsers.length}<li class="empty">No scouts match.</li>{/if}
          </ul>
        </div>

        <aside class="pool" aria-label="Unassigned teams">
          <div class="pool-head">
            <h4>Unassigned</h4>
            <span>{unassignedTeams.length}</span>
          </div>
          {#if !scheduledTeamKeys.length}
            <p class="muted">The teams come from the match schedule, which is not loaded yet.</p>
          {:else if !unassignedTeams.length}
            <p class="done">Every team has a scout.</p>
          {:else}
            <p class="muted">
              Click teams to select, then press Assign on a scout. You can also drag one onto a scout, or type team
              numbers in a scout's Add team box.
            </p>
            <input
              class="pool-search"
              type="search"
              inputmode="numeric"
              placeholder="Find a team"
              bind:value={poolSearch}
              aria-label="Find an unassigned team"
            />
            <div class="pool-chips">
              {#each shownUnassigned as team (team)}
                <button
                  type="button"
                  class="pick"
                  class:on={selectedSet.has(team)}
                  class:dragging={draggingTeamKey === team}
                  aria-pressed={selectedSet.has(team)}
                  on:click={() => toggleSelect(team)}
                  on:pointerdown|capture={(event) => {
                    if (event.pointerType === 'mouse' && event.shiftKey) return;
                  }}>{displayTeam(team)}</button
                >
              {/each}
            </div>
            {#if !shownUnassigned.length}<p class="muted">No unassigned team matches "{poolSearch}".</p>{/if}
            {#if selectedTeams.length}<button type="button" class="link" on:click={() => (selectedTeams = [])}
                >Clear selection ({selectedTeams.length})</button
              >{:else if shownUnassigned.length}<button
                type="button"
                class="link"
                on:click={() => (selectedTeams = [...shownUnassigned])}>Select {poolQuery ? 'these' : 'all'}</button
              >{/if}
          {/if}
          {#if partialTeams.length}
            <div class="partial">
              <h5>Partly assigned</h5>
              <p class="muted">Some matches have a scout and others do not, or they are split between scouts.</p>
              <div class="pool-chips">
                {#each partialTeams as team (team)}<button
                    type="button"
                    class="pick"
                    class:on={selectedSet.has(team)}
                    on:click={() => toggleSelect(team)}>{displayTeam(team)}</button
                  >{/each}
              </div>
            </div>
          {/if}
        </aside>
      </div>
    {:else}
      <p class="note">Assignments are read-only unless you are a scouting lead.</p>
    {/if}

    {#if draggingTeamKey}
      <div
        class="team-drag-ghost"
        style={`left:${zoomed(dragClientX) + 12}px;top:${zoomed(dragClientY) + 12}px`}
        aria-hidden="true"
      >
        #{displayTeam(draggingTeamKey)}
      </div>
    {/if}

    <details class="table-accordion">
      <summary>Match-by-match table ({matches.length} match{matches.length === 1 ? '' : 'es'})</summary>
      <div class="scroll-x">
        <table class="assignment-table">
          <thead>
            <tr>
              <th colspan="3" class="alliance blue">Blue Alliance</th>
              <th colspan="3" class="alliance red">Red Alliance</th>
            </tr>
            <tr>
              {#each [1, 2, 3] as i}<th class="blue">B{i}</th>{/each}
              {#each [1, 2, 3] as i}<th class="red">R{i}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each matches as m}
              <tr>
                {#each m.blue as t, i}
                  <td
                    data-label={`Blue ${i + 1}`}
                    class="cell blue"
                    class:editable-cell={capabilities.can_edit}
                    on:click={() => openAssign(m.key, t)}
                  >
                    <span class="team">#{displayTeam(t)}</span><span class="scout"
                      >{#if showKinds && assignments?.[m.key]?.[t]?.user_id}<span
                          class="kind-badge"
                          aria-label={KIND_LABELS[kindByUser.get(assignments[m.key][t].user_id) || 'data']}
                          >{kindShort(kindByUser.get(assignments[m.key][t].user_id))}</span
                        >{/if}{assignments?.[m.key]?.[t]?.user_name || '-'}</span
                    >
                  </td>
                {/each}
                {#each m.red as t, i}
                  <td
                    data-label={`Red ${i + 1}`}
                    class="cell red"
                    class:editable-cell={capabilities.can_edit}
                    on:click={() => openAssign(m.key, t)}
                  >
                    <span class="team">#{displayTeam(t)}</span><span class="scout"
                      >{#if showKinds && assignments?.[m.key]?.[t]?.user_id}<span
                          class="kind-badge"
                          aria-label={KIND_LABELS[kindByUser.get(assignments[m.key][t].user_id) || 'data']}
                          >{kindShort(kindByUser.get(assignments[m.key][t].user_id))}</span
                        >{/if}{assignments?.[m.key]?.[t]?.user_name || '-'}</span
                    >
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  </section>
{/if}

{#if showModal}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close assignment dialog"
    on:click|self={() => {
      if (!saving) showModal = false;
    }}
    on:keydown={(e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!saving) showModal = false;
      }
    }}
  >
    <div
      class="modal"
      style="--modal-width: 360px;"
      role="dialog"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <h4>Assign Scout - {modalContext.team_number}</h4>
      <Select class="form-select" bind:value={selectedUserId} disabled={saving}>
        <option value="">-- choose user --</option>
        {#each users as u}
          <option value={u.id}>{scoutDisplayName(u)}</option>
        {/each}
      </Select>
      <div class="btn-row modal-actions">
        <button class="btn btn-primary" disabled={!selectedUserId || saving} on:click={() => saveAssignment(false)}
          >Stage this Match</button
        >
        <button class="btn btn-secondary" disabled={!selectedUserId || saving} on:click={() => saveAssignment(true)}
          >Stage Robot</button
        >
        {#if publishedAssignments?.[modalContext.match_key]?.[modalContext.team_key]?.user_id}
          <button
            class="btn btn-danger"
            disabled={saving}
            title="Removes the assignment and notifies the scout right away"
            on:click={removeAssignment}>Remove Assignment</button
          >
        {/if}
        <button
          class="btn btn-outline"
          on:click={() => {
            if (!saving) showModal = false;
          }}>Close</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .board {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  h3 {
    margin: 0;
    font-size: 1.15rem;
  }
  .sub {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .head-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--border);
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 0.88rem;
  }
  .note.pending {
    border-left-color: var(--accent);
    color: var(--text);
  }
  .note.err {
    border-left-color: var(--danger);
    color: var(--text);
  }

  .skel {
    display: grid;
    gap: var(--space-2);
  }
  .skel-bar,
  .skel-av,
  .skel-line {
    background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
    background-size: 200% 100%;
    animation: skel 1.3s ease-in-out infinite;
    border-radius: var(--radius-sm);
  }
  .skel-bar {
    height: 2.3rem;
    width: 16rem;
  }
  .skel-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .skel-av {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
  }
  .skel-line {
    height: 0.9rem;
  }
  .skel-line.w1 {
    width: 9rem;
  }
  .skel-line.w2 {
    width: 14rem;
  }
  @keyframes skel {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skel-bar,
    .skel-av,
    .skel-line {
      animation: none;
    }
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 17rem;
    gap: var(--space-4);
    align-items: start;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    align-items: center;
    margin-bottom: var(--space-3);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: 0.84rem;
  }
  .filter {
    width: 100%;
    max-width: 16rem;
    min-height: 2.3rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
  }
  .filter:focus {
    outline: none;
    border-color: var(--accent);
  }
  .scout-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .scout {
    display: grid;
    grid-template-columns: 2.2rem minmax(10rem, 14rem) minmax(0, 1fr);
    gap: var(--space-3) var(--space-4);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    transition: background 0.15s ease;
  }
  .scout:last-child {
    border-bottom: 0;
  }
  .scout:hover {
    background: var(--surface-2);
  }
  .scout.drop-target {
    background: var(--accent-subtle);
    border-left-color: var(--accent);
  }
  .av {
    display: grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    background: var(--surface-3);
    color: var(--text-secondary);
    font-weight: 600;
  }
  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .who b {
    overflow-wrap: anywhere;
    line-height: 1.25;
  }
  /* The role is a label on its own line (like the role in My assignments), so the name keeps the full column. */
  .kind {
    font-family: var(--font-display);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kind-badge {
    display: inline-block;
    min-width: 1rem;
    margin-right: 0.3rem;
    font-family: var(--font-display);
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .who small {
    color: var(--text-muted);
  }
  .load {
    height: 3px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .load i {
    display: block;
    height: 100%;
    background: var(--text-muted);
  }
  .teams {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    padding: 0 0.2rem 0 0.1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .chip.draft {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }
  .draft-tag {
    margin-left: 0.3rem;
    color: var(--text-muted);
    font-size: max(0.7rem, var(--text-min));
    font-weight: 500;
  }
  .kind-key {
    color: var(--text-muted);
    font-size: max(var(--font-xs), var(--text-min));
  }
  .chip .num {
    padding: 0.3rem 0.35rem 0.3rem 0.5rem;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    cursor: grab;
    touch-action: none;
  }
  .chip .x {
    display: grid;
    place-items: center;
    width: 1.3rem;
    height: 1.3rem;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.6;
  }
  .chip:hover .x {
    opacity: 1;
  }
  .chip .x:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .chip .x:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .add {
    width: 6.5rem;
    min-height: 2rem;
    padding: 0 var(--space-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
  }
  .add:focus {
    outline: none;
    border-style: solid;
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .take {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent-subtle);
    color: var(--accent-strong);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .clash {
    grid-column: 2 / -1;
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.82rem;
    padding-left: var(--space-2);
    border-left: 2px solid var(--accent);
  }
  .empty {
    padding: var(--space-5);
    text-align: center;
    color: var(--text-muted);
  }

  .pool {
    position: sticky;
    top: var(--space-4);
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .pool-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .pool-head h4,
  .partial h5 {
    margin: 0;
    font-size: 0.95rem;
  }
  .pool-head span {
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
    font-weight: 600;
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.84rem;
    line-height: 1.5;
  }
  .done {
    margin: 0;
    color: var(--text);
    font-size: 0.92rem;
  }
  .pool-search {
    min-height: 2.1rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
  }
  .pool-search:focus {
    outline: none;
    border-color: var(--accent);
  }
  .pool-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    max-height: 16rem;
    overflow-y: auto;
  }
  .pick {
    min-width: 3.1rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .pick:hover {
    border-color: var(--text-muted);
  }
  .pick.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
  }
  .pick.dragging {
    opacity: 0.4;
  }
  .link {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    font-size: 0.86rem;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .partial {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .team-drag-ghost {
    position: fixed;
    z-index: 1000;
    pointer-events: none;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 0.85rem;
    font-weight: 600;
  }

  @media (max-width: 1000px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .pool {
      position: static;
      order: -1;
    }
  }
  @media (max-width: 700px) {
    .board {
      padding: var(--space-3);
    }
    .scout {
      grid-template-columns: 2.2rem minmax(0, 1fr);
    }
    .scout .teams,
    .scout .clash {
      grid-column: 1 / -1;
    }
  }

  /* Assignment table */
  .scroll-x {
    overflow-x: auto;
  }

  .assignment-table {
    border-collapse: separate;
    border-spacing: 2px;
    width: 100%;
  }

  .assignment-table th,
  .assignment-table td {
    padding: 3px var(--space-2);
    font-size: var(--font-xs);
    text-align: center;
    background: var(--color-white, #fff);
    border: 1px solid var(--border);
    min-width: 70px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .assignment-table th.alliance {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .assignment-table .blue {
    background: var(--blue-soft);
  }

  .assignment-table .red {
    background: var(--red-soft);
  }

  /* Team and scout used to stack on two lines per cell, roughly doubling
     the height of an already very tall (one row per match) table. One line
     per cell - "#123 · Name" - keeps every cell readable at a fraction of
     the height, which is the point of compacting this table at all. */
  .assignment-table .team {
    font-weight: 700;
  }

  .assignment-table .scout {
    font-size: 0.62rem;
    color: var(--text-muted);
  }

  .assignment-table .scout::before {
    content: ' · ';
  }

  .editable-cell {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .editable-cell:hover {
    filter: brightness(0.93);
  }

  /* The 6-column Blue/Red alliance grid (each td already a min-width:70px
     table cell, 6 of them a guaranteed 420px+ floor) becomes one card per
     match below phone width, its six alliance slots stacked in the same
     blue-then-red order instead of packed into columns too narrow to read.
     A data-label attribute on each <td> (see markup) supplies "Blue 1" /
     "Red 2" etc since the real header rows are hidden here. */
  @media (max-width: 640px) {
    .scroll-x {
      overflow-x: visible;
    }
    .assignment-table thead {
      display: none;
    }
    .assignment-table,
    .assignment-table tbody,
    .assignment-table tr,
    .assignment-table td {
      display: block;
      width: 100%;
      min-width: 0;
    }
    .assignment-table tr {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      margin-bottom: var(--space-2);
      overflow: hidden;
    }
    .assignment-table td {
      text-align: left;
      border: 0;
      border-bottom: 1px solid var(--border);
      padding: var(--space-2) var(--space-3);
    }
    .assignment-table tr td:last-child {
      border-bottom: 0;
    }
    .assignment-table td::before {
      content: attr(data-label);
      display: block;
      color: var(--text-muted);
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }
    .assignment-table td {
      white-space: normal;
    }
  }

  /* Collapsed by default - a full event's match list here is one row per
     scheduled qualification match (dozens at a real event), which dwarfed
     the rest of the page. The drag-and-drop board above already covers
     assigning; this table is the detailed read/override view underneath. */
  .table-accordion {
    margin-top: var(--gap-2);
  }

  .table-accordion > summary {
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2, #f7f7f5);
    font-size: var(--font-xs);
    font-weight: 700;
    color: var(--text-muted);
    list-style: none;
    user-select: none;
  }

  .table-accordion > summary::-webkit-details-marker {
    display: none;
  }

  .table-accordion > summary::before {
    content: '▸ ';
  }

  .table-accordion[open] > summary::before {
    content: '▾ ';
  }

  .table-accordion .scroll-x {
    margin-top: var(--gap-2);
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .who b,
    .assignment-table td {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

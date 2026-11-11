<script>
  import { visibleInterval } from '$lib/ui/visibility.js';
  import { onDestroy, onMount } from 'svelte';
  import { dragHandleZone, dragHandle } from 'svelte-dnd-action';
  import { AlertTriangle, GripVertical, RefreshCw, X } from 'lucide-svelte';
  import { authFetch, getAuthHeader } from '$lib/app/supabase.js';
  import { submitOrQueue } from '$lib/app/offlineQueue.js';
  import { fetchWithCache } from '$lib/app/offlineCache.js';
  import { fetchActiveScoutingEventKey, fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
  import { buildStrategyRows } from '$lib/scouting/strategyScouting.js';
  import {
    applyPairwiseConsensus,
    blendMatchRankings,
    buildPowerRankings,
    DEFAULT_SCOUT_POWER_WEIGHTS,
    matchRankingsToPairwiseVotes
  } from '$lib/scouting/scoutingStats.js';
  import { buildPicklistInsights } from '$lib/scouting/picklistInsights.js';
  import { ourTeamKey } from '$lib/stores/team.js';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';

  // Split out of Strategy into its own top-level Competition tab per direct
  // instruction - alliance selection is its own workflow the whole scouting
  // group opens repeatedly during a competition, not a sub-view of the
  // Teams/Matches board. Still reuses everything Strategy's Picklist tab
  // already built: the scouting_picklist table/API, buildPowerRankings, and
  // the AI move-flagging endpoint - nothing about the underlying data model
  // changed, just where the UI for it lives.
  // The team this app belongs to, from Team settings.
  $: OUR_TEAM_KEY = $ourTeamKey;
  // The list is one shared list per event (every scout sees and edits the same
  // order). It refreshes quietly so an edit made on another phone shows up here.
  const PICKLIST_REFRESH_MS = 30000;
  // The scores and match rankings behind the columns and the auto rank refresh too, so new reports and rankings
  // show up without reloading the page. The list order itself only changes when someone drags or replaces it.
  const SCORES_REFRESH_MS = 60000;
  let eventKey = '';
  let selectedEventKey = null;
  let availableEvents = [];
  let report = null;
  let eventTeams = [];
  let fallbackNames = {};
  let teamsWarning = '';
  let loadedEventKey = '';
  let loading = true;
  let error = '';

  let picklistEntries = [];
  let picklistLoading = false;
  let picklistError = '';
  let loadedPicklistEventKey = '';
  let dragOrderSnapshot = null;
  let flagsByEntryId = new Map();
  let officialRankings = [];
  let officialNote = '';
  let lastSyncedAt = null;
  let noteDrafts = {};
  let stopRefresh = () => {};
  let stopScoresRefresh = () => {};
  let matchRankings = [];
  let rankingsNote = '';
  let sliderWeights = {
    performance: DEFAULT_SCOUT_POWER_WEIGHTS.performance * 100,
    notes: DEFAULT_SCOUT_POWER_WEIGHTS.notes * 100,
    reliability: DEFAULT_SCOUT_POWER_WEIGHTS.reliability * 100,
    opr: DEFAULT_SCOUT_POWER_WEIGHTS.opr * 100,
    // The match-ranking consensus (Match Rankings tab), blended on top of Scout Power by blendMatchRankings().
    rankings: 30
  };

  $: resolvedEventKey = selectedEventKey || eventKey;
  $: rows = buildStrategyRows(report?.data || {}, eventTeams);
  $: activeEventLabel = availableEvents.find((option) => option.value === eventKey)?.label || eventKey || 'not set';
  $: browseEventOptions = availableEvents.filter((option) => option.value !== eventKey);
  $: powerRankings = buildPowerRankings(
    rows.map((row) => ({ key: row.teamKey, team_number: Number(row.teamNumber) || 0, nickname: '' })),
    report?.data?.data_events || [],
    report?.data?.notes || [],
    {
      pitEntries: report?.data?.pit_entries || [],
      problemReports: report?.data?.pit_problems || [],
      matchEntries: report?.data?.match_entries || []
    }
  );
  $: scoutPowerByTeam = new Map(powerRankings.map((team) => [team.key, team.scoutPower]));
  $: rankedPower = applyPairwiseConsensus(powerRankings, matchRankingsToPairwiseVotes(matchRankings));
  $: insights = buildPicklistInsights({
    strategyRows: rows,
    powerRankings: rankedPower,
    officialRankings,
    ourTeamKey: OUR_TEAM_KEY
  });
  $: normalizedSliderWeights = (() => {
    const total =
      sliderWeights.performance +
      sliderWeights.notes +
      sliderWeights.reliability +
      sliderWeights.opr +
      sliderWeights.rankings;
    if (!total) return { ...DEFAULT_SCOUT_POWER_WEIGHTS, rankings: 0 };
    return {
      performance: sliderWeights.performance / total,
      notes: sliderWeights.notes / total,
      reliability: sliderWeights.reliability / total,
      opr: sliderWeights.opr / total,
      rankings: sliderWeights.rankings / total
    };
  })();
  $: autoRankedRows = blendMatchRankings(
    buildPowerRankings(
      rows.map((row) => ({ key: row.teamKey, team_number: Number(row.teamNumber) || 0, nickname: '' })),
      report?.data?.data_events || [],
      report?.data?.notes || [],
      {
        pitEntries: report?.data?.pit_entries || [],
        problemReports: report?.data?.pit_problems || [],
        matchEntries: report?.data?.match_entries || []
      },
      normalizedSliderWeights
    ),
    matchRankings,
    normalizedSliderWeights.rankings
  );
  $: if (resolvedEventKey && resolvedEventKey !== loadedPicklistEventKey && !picklistLoading) void loadPicklist();

  // Real team names: the event roster first, then a per-team TBA lookup for
  // anyone missing from it (a roster can lag behind scouting data), then
  // whatever nickname the pick list row itself stored.
  $: nameByTeam = (() => {
    const names = new Map();
    for (const team of eventTeams) {
      const name = String(team?.nickname || team?.name || '').trim();
      if (team?.key && name) names.set(team.key, name);
    }
    for (const [key, name] of Object.entries(fallbackNames)) if (!names.has(key)) names.set(key, name);
    for (const entry of picklistEntries) {
      const name = String(entry?.nickname || '').trim();
      if (name && !names.has(entry.team_key)) names.set(entry.team_key, name);
    }
    return names;
  })();
  $: missingNameKeys = [
    ...new Set([...picklistEntries.map((e) => e.team_key), ...autoRankedRows.map((t) => t.key)])
  ].filter((key) => key && !nameByTeam.has(key) && !(key in requestedNameKeys));
  let requestedNameKeys = {};
  $: if (missingNameKeys.length) void loadMissingNames(missingNameKeys);
  async function loadMissingNames(keys) {
    requestedNameKeys = { ...requestedNameKeys, ...Object.fromEntries(keys.map((key) => [key, true])) };
    try {
      const response = await fetch(`/api/tba/teams-simple?team_keys=${encodeURIComponent(keys.join(','))}`);
      const payload = await response.json().catch(() => null);
      const found = {};
      for (const row of payload?.data || []) {
        const name = String(row?.nickname || row?.name || '').trim();
        if (row?.key && name) found[row.key] = name;
      }
      fallbackNames = { ...fallbackNames, ...found };
    } catch {
      // Names are decoration - a failed lookup just leaves the number.
    }
  }

  const teamNumber = (teamKey) => String(teamKey || '').replace(/^frc/i, '');
  const number = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '-');
  const rankLabel = (value) => (Number.isFinite(value) ? `#${value}` : '-');
  const teamHref = (teamKey) =>
    `/teamview?event_key=${encodeURIComponent(resolvedEventKey)}&team=${encodeURIComponent(teamKey)}&from=${encodeURIComponent('/picklist')}&fromLabel=${encodeURIComponent('Picklist')}`;

  function teamSummaryPayload(teamKey) {
    const row = rows.find((item) => item.teamKey === teamKey);
    if (!row) return { teamNumber: teamNumber(teamKey) };
    return {
      teamNumber: row.teamNumber,
      scoutPower: scoutPowerByTeam.get(teamKey) ?? null,
      avgFuel: row.performance.avgFuel,
      avgBallsScored: row.matchScoutSummary.avgBallsScored,
      openProblems: row.openProblems.length
    };
  }

  async function loadPicklist() {
    if (!resolvedEventKey) {
      picklistEntries = [];
      return;
    }
    picklistLoading = true;
    picklistError = '';
    try {
      const response = await authFetch(`/api/scouting-picklist?event_key=${encodeURIComponent(resolvedEventKey)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Could not load the pick list.');
      picklistEntries = payload.data || [];
      loadedPicklistEventKey = resolvedEventKey;
      lastSyncedAt = new Date();
      if (!picklistEntries.length && autoRankedRows.length) await seedPicklistFromAutoRank();
    } catch (cause) {
      picklistError = cause?.message || 'Could not load the pick list.';
      // Remember the attempt, so a failed load shows its error instead of retrying in a loop.
      loadedPicklistEventKey = resolvedEventKey;
    } finally {
      picklistLoading = false;
    }
  }

  async function seedPicklistFromAutoRank() {
    if (!resolvedEventKey || !autoRankedRows.length) return;
    picklistLoading = true;
    picklistError = '';
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
      await Promise.all(
        autoRankedRows.map(async (team) => {
          const addResponse = await fetch('/api/scouting-picklist', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              action: 'add',
              event_key: resolvedEventKey,
              team_key: team.key,
              team_number: team.team_number
            })
          });
          if (!addResponse.ok && addResponse.status !== 409) {
            const addPayload = await addResponse.json().catch(() => null);
            throw new Error(addPayload?.error || `Could not add team ${team.team_number} to the pick list.`);
          }
        })
      );
      const listResponse = await authFetch(`/api/scouting-picklist?event_key=${encodeURIComponent(resolvedEventKey)}`);
      const listPayload = await listResponse.json().catch(() => null);
      if (!listResponse.ok || !listPayload?.success)
        throw new Error(listPayload?.error || 'Could not reload the pick list.');
      const idByTeamKey = new Map((listPayload.data || []).map((entry) => [entry.team_key, entry.id]));
      const orderedIds = autoRankedRows.map((team) => idByTeamKey.get(team.key)).filter(Boolean);
      const reorderResponse = await fetch('/api/scouting-picklist', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'reorder', event_key: resolvedEventKey, ordered_ids: orderedIds })
      });
      const reorderPayload = await reorderResponse.json().catch(() => null);
      if (!reorderResponse.ok || !reorderPayload?.success)
        throw new Error(reorderPayload?.error || 'Could not order the pick list.');
      const entryById = new Map((listPayload.data || []).map((entry) => [entry.id, entry]));
      picklistEntries = orderedIds.map((id) => entryById.get(id)).filter(Boolean);
      loadedPicklistEventKey = resolvedEventKey;
    } catch (cause) {
      picklistError = cause?.message || 'Could not seed the pick list from the auto rank.';
    } finally {
      picklistLoading = false;
    }
  }

  // Pull everyone else's changes without a spinner. Skipped while this person
  // is mid-drag or typing a note, so their own edit is never overwritten.
  async function refreshPicklistQuietly() {
    if (!resolvedEventKey || picklistLoading || dragOrderSnapshot !== null || Object.keys(noteDrafts).length) return;
    try {
      const response = await authFetch(`/api/scouting-picklist?event_key=${encodeURIComponent(resolvedEventKey)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success || dragOrderSnapshot !== null || Object.keys(noteDrafts).length) return;
      picklistEntries = payload.data || [];
      lastSyncedAt = new Date();
    } catch {
      // Background refresh only - the list on screen is still valid.
    }
  }

  function startNoteEdit(entry) {
    noteDrafts = { ...noteDrafts, [entry.id]: entry.note || '' };
  }

  async function saveNote(entry) {
    const draft = noteDrafts[entry.id];
    const next = { ...noteDrafts };
    delete next[entry.id];
    noteDrafts = next;
    if (draft === undefined || draft === (entry.note || '')) return;
    const trimmed = draft.trim();
    picklistEntries = picklistEntries.map((item) => (item.id === entry.id ? { ...item, note: trimmed || null } : item));
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
      const response = await fetch('/api/scouting-picklist', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'note', id: entry.id, note: trimmed })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Could not save the note.');
    } catch (cause) {
      picklistError = cause?.message || 'Could not save the note.';
    }
  }

  async function removeFromPicklist(id) {
    picklistEntries = picklistEntries.filter((entry) => entry.id !== id);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
      await fetch('/api/scouting-picklist', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'remove', id })
      });
    } catch (cause) {
      picklistError = cause?.message || 'Could not remove that team from the pick list.';
    }
  }

  function handlePicklistConsider(e) {
    if (dragOrderSnapshot === null) dragOrderSnapshot = picklistEntries.map((entry) => entry.id);
    picklistEntries = e.detail.items;
  }

  async function handlePicklistFinalize(e) {
    const finalItems = e.detail.items;
    const movedId = e.detail.info?.id;
    const previousOrder = dragOrderSnapshot;
    dragOrderSnapshot = null;
    picklistEntries = finalItems;

    try {
      // Reordering the same target positions is idempotent - a queued
      // retry landing after an earlier attempt actually succeeded (the
      // drag already shows the new order locally either way) just
      // reapplies the same positions, not a duplicate or conflicting one.
      const result = await submitOrQueue({
        url: '/api/scouting-picklist',
        headers: await getAuthHeader(),
        label: 'Picklist reorder',
        body: { action: 'reorder', event_key: resolvedEventKey, ordered_ids: finalItems.map((entry) => entry.id) }
      });
      if (result.queued)
        picklistError = "Reordered on this phone - no connection right now, so it'll sync once you're back online.";
    } catch (cause) {
      picklistError = cause?.message || 'Could not save the new order.';
    }

    if (movedId && previousOrder) {
      const fromIndex = previousOrder.indexOf(movedId);
      const toIndex = finalItems.findIndex((entry) => entry.id === movedId);
      if (fromIndex !== toIndex) void flagPicklistMove(movedId, fromIndex, toIndex, finalItems);
    }
  }

  async function flagPicklistMove(movedId, fromIndex, toIndex, items) {
    const movedEntry = items.find((entry) => entry.id === movedId);
    if (!movedEntry) return;
    const neighborEntries = items.filter((entry, index) => entry.id !== movedId && Math.abs(index - toIndex) <= 2);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
      const response = await fetch('/api/scouting-picklist/flag-move', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          movedTeam: teamSummaryPayload(movedEntry.team_key),
          fromIndex: fromIndex + 1,
          toIndex: toIndex + 1,
          neighbors: neighborEntries.map((entry) => teamSummaryPayload(entry.team_key))
        })
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success && payload.flagged) {
        flagsByEntryId = new Map(flagsByEntryId).set(movedId, payload.reason || 'Flagged - review this move.');
      } else {
        const next = new Map(flagsByEntryId);
        next.delete(movedId);
        flagsByEntryId = next;
      }
    } catch {
      // Advisory only - flagging unavailable this time is not an error.
    }
  }

  // The scouting report and match rankings behind the scores.
  async function fetchScores(forEventKey) {
    const headers = await getAuthHeader();
    const event = encodeURIComponent(forEventKey);
    const [reportResponse, rankingsPayload] = await Promise.all([
      fetch(`/api/scouting-report?event_key=${event}`, { headers }),
      fetch(`/api/scouting-match-rankings?event_key=${event}`, { headers })
        .then((response) => response.json())
        .catch(() => null)
    ]);
    const payload = await reportResponse.json().catch(() => null);
    if (!reportResponse.ok || !payload?.success) throw new Error(payload?.error || 'Could not load scouting data.');
    const rankingsOk = rankingsPayload?.success;
    return {
      report: payload,
      matchRankings: rankingsOk ? rankingsPayload.data || [] : [],
      rankingsNote: rankingsOk
        ? ''
        : rankingsPayload?.error || 'Match rankings are unavailable right now, so the auto rank leaves them out.'
    };
  }

  // Background refresh of the scores and match rankings, so the columns and the auto rank follow new reports.
  async function refreshScoresQuietly() {
    const forEventKey = resolvedEventKey;
    if (!forEventKey || loading || !report) return;
    try {
      const scores = await fetchScores(forEventKey);
      if (forEventKey !== resolvedEventKey || loading) return;
      report = scores.report;
      matchRankings = scores.matchRankings;
      rankingsNote = scores.rankingsNote;
    } catch {
      // Background refresh only - the scores on screen are still valid.
    }
  }

  async function loadPicklistPage() {
    if (!resolvedEventKey) {
      report = null;
      loading = false;
      return;
    }
    loading = true;
    error = '';
    teamsWarning = '';
    try {
      officialNote = '';
      const [scores] = await Promise.all([
        fetchScores(resolvedEventKey),
        // Official qualification standings, to show which teams rank above us.
        // Reference only: a TBA outage must not hide the picklist itself.
        fetchWithCache(`/api/tba/event-rankings?event_key=${encodeURIComponent(resolvedEventKey)}`, {
          cacheKey: `event-rankings:${resolvedEventKey}`,
          onUpdate: (rankingsPayload) => {
            if (rankingsPayload?.success) {
              officialRankings = rankingsPayload.data?.rankings || [];
              officialNote = '';
            } else officialNote = 'Official rankings are unavailable right now, so teams above us are not highlighted.';
          }
        }).catch(() => {
          officialNote = 'Official rankings are unavailable right now, so teams above us are not highlighted.';
        }),
        // Roster barely changes mid-event - cached, so a slow link doesn't
        // delay showing the pick list itself.
        fetchWithCache(`/api/tba/event-teams?event_key=${encodeURIComponent(resolvedEventKey)}`, {
          cacheKey: `event-teams:${resolvedEventKey}`,
          onUpdate: (teamsPayload) => {
            if (teamsPayload?.success) {
              eventTeams = teamsPayload.data || [];
              teamsWarning = '';
            } else teamsWarning = teamsPayload?.error || 'Could not load the event roster from The Blue Alliance.';
          }
        }).catch(() => {
          teamsWarning = 'Could not load the event roster from The Blue Alliance.';
        })
      ]);
      report = scores.report;
      matchRankings = scores.matchRankings;
      rankingsNote = scores.rankingsNote;
      loadedEventKey = resolvedEventKey;
    } catch (cause) {
      report = null;
      matchRankings = [];
      eventTeams = [];
      error = cause?.message || 'Could not load scouting data.';
    } finally {
      loadedEventKey = resolvedEventKey;
      loading = false;
    }
  }

  onMount(async () => {
    stopRefresh = visibleInterval(refreshPicklistQuietly, PICKLIST_REFRESH_MS); // paused while the tab is hidden
    stopScoresRefresh = visibleInterval(refreshScoresQuietly, SCORES_REFRESH_MS);
    [eventKey, availableEvents] = await Promise.all([fetchActiveScoutingEventKey(), fetchAvailableScoutingEvents()]);
    await loadPicklistPage();
  });
  onDestroy(() => {
    stopRefresh();
    stopScoresRefresh();
  });

  $: if (resolvedEventKey && resolvedEventKey !== loadedEventKey && !loading) void loadPicklistPage();
</script>

<svelte:head><title>Picklist</title></svelte:head>

<header class="head">
  <div>
    <h1>Picklist</h1>
    {#if resolvedEventKey && !loading}
      <p class="sub">
        {picklistEntries.length} team{picklistEntries.length === 1 ? '' : 's'}
        {#if insights.ourRank != null}
          · we are {rankLabel(insights.ourRank)}{/if}
        {#if lastSyncedAt}
          · synced {lastSyncedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{/if}
      </p>
    {/if}
  </div>
  <div class="actions with-select">
    <SeasonFilter
      options={browseEventOptions}
      bind:value={selectedEventKey}
      allLabel={`Current Event (${activeEventLabel})`}
    />
    <button
      class="icon-btn"
      on:click={loadPicklistPage}
      disabled={loading || !resolvedEventKey}
      aria-label="Refresh"
      title="Refresh"><RefreshCw size={16} /></button
    >
  </div>
</header>

{#if !resolvedEventKey}
  <p class="empty">Set an active scouting event in Scouting Admin to build the picklist.</p>
{:else if loading}
  <p class="empty">Loading...</p>
{:else if error}
  <p class="empty err">{error}</p>
{:else}
  {#if teamsWarning}<p class="notice">{teamsWarning}</p>{/if}
  {#if officialNote}<p class="notice">{officialNote}</p>{/if}
  {#if rankingsNote}<p class="notice">{rankingsNote}</p>{/if}

  <div class="layout">
    <section class="board" aria-label="Picklist">
      {#if picklistError}<p class="empty err">{picklistError}</p>{/if}
      {#if picklistLoading && !picklistEntries.length}
        <p class="empty">Loading...</p>
      {:else if !picklistEntries.length}
        <p class="empty">
          Nothing on the list yet. Send teams from the <a href="/strategy">Strategy Board</a>, or start from the auto
          rank on the right.
        </p>
        <button
          class="text-btn"
          on:click={seedPicklistFromAutoRank}
          disabled={picklistLoading || !autoRankedRows.length}>Start from auto rank</button
        >
      {:else}
        <div class="cols" aria-hidden="true">
          <span></span><span>#</span><span>Team</span>
          <span class="num">Event</span>
          <span class="num">Power</span>
          <span class="num">Match</span>
          <span class="num hide-sm">Skill</span>
          <span class="num hide-sm">Driving</span>
          <span class="num">Broken</span>
          <span class="num hide-sm">Issues</span>
          <span class="num hide-sm">Scouted</span>
          <span class="hide-md">Note</span><span></span>
        </div>
        <ul
          class="rows"
          use:dragHandleZone={{ items: picklistEntries, flipDurationMs: 150 }}
          on:consider={handlePicklistConsider}
          on:finalize={handlePicklistFinalize}
        >
          {#each picklistEntries as entry, index (entry.id)}
            {@const insight = insights.byTeam.get(entry.team_key)}
            <li class="row" class:above={insight?.aboveUs}>
              <span class="grip" use:dragHandle aria-label={`Drag to reorder team ${entry.team_number}`}
                ><GripVertical size={16} /></span
              >
              <span class="pos">{index + 1}</span>
              <span class="team">
                <a href={teamHref(entry.team_key)}>{entry.team_number}</a>
                {#if nameByTeam.get(entry.team_key)}<span class="tname">{nameByTeam.get(entry.team_key)}</span>{/if}
                {#if flagsByEntryId.get(entry.id)}<span class="flag"
                    ><AlertTriangle size={13} /> {flagsByEntryId.get(entry.id)}</span
                  >{/if}
              </span>
              <span class="num" data-label="Event">{insight ? rankLabel(insight.officialRank) : '-'}</span>
              <span class="num" data-label="Power"
                >{insight ? rankLabel(insight.powerRank) : '-'}{#if insight}<small>{number(insight.scoutPower)}</small
                  >{/if}</span
              >
              <span class="num" data-label="Match"
                >{insight ? rankLabel(insight.matchRank) : '-'}{#if insight?.matchRankVotes}<small
                    >{insight.matchRankVotes}</small
                  >{/if}</span
              >
              <span class="num hide-sm" data-label="Skill">{insight ? number(insight.driverSkill) : '-'}</span>
              <span class="num hide-sm" data-label="Driving">{insight ? number(insight.drivingRank) : '-'}</span>
              <span class="num" data-label="Broken" class:warn={insight?.timesBroken > 0}
                >{insight ? insight.timesBroken : '-'}</span
              >
              <span class="num hide-sm" data-label="Issues" class:warn={insight?.openProblems > 0}
                >{insight ? insight.openProblems : '-'}</span
              >
              <span class="num hide-sm" data-label="Scouted">{insight ? insight.matchesScouted : '-'}</span>
              <input
                class="note hide-md"
                type="text"
                maxlength="300"
                placeholder="Note"
                aria-label={`Note for team ${entry.team_number}`}
                value={noteDrafts[entry.id] ?? entry.note ?? ''}
                on:focus={() => startNoteEdit(entry)}
                on:input={(event) => (noteDrafts = { ...noteDrafts, [entry.id]: event.currentTarget.value })}
                on:blur={() => saveNote(entry)}
                on:keydown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <button
                class="rm"
                on:click={() => removeFromPicklist(entry.id)}
                aria-label={`Remove team ${entry.team_number}`}
                title="Remove"><X size={15} /></button
              >
            </li>
          {/each}
        </ul>
        <p class="col-notes">
          <b>Event</b> official qualification rank · <b>Power</b> our scouting power rank (score) · <b>Match</b> place
          in the match-ranking consensus (head-to-heads counted) · <b>Skill</b> average driver skill · <b>Driving</b>
          average driving rank (1 bad, 3 great) · <b>Broken</b> matches where the robot crashed, broke or was disabled ·
          <b>Issues</b>
          unresolved pit problems · <b>Scouted</b> matches our scouts covered
        </p>
      {/if}
    </section>

    <aside class="auto">
      <details open>
        <summary>Auto rank</summary>
        <div class="sliders">
          <label
            ><span>Performance</span><b>{Math.round(normalizedSliderWeights.performance * 100)}</b><input
              type="range"
              min="0"
              max="100"
              step="1"
              bind:value={sliderWeights.performance}
            /></label
          >
          <label
            ><span>Notes</span><b>{Math.round(normalizedSliderWeights.notes * 100)}</b><input
              type="range"
              min="0"
              max="100"
              step="1"
              bind:value={sliderWeights.notes}
            /></label
          >
          <label
            ><span>Reliability</span><b>{Math.round(normalizedSliderWeights.reliability * 100)}</b><input
              type="range"
              min="0"
              max="100"
              step="1"
              bind:value={sliderWeights.reliability}
            /></label
          >
          <label
            ><span>OPR</span><b>{Math.round(normalizedSliderWeights.opr * 100)}</b><input
              type="range"
              min="0"
              max="100"
              step="1"
              bind:value={sliderWeights.opr}
            /></label
          >
          <label
            ><span>Match rankings</span><b>{Math.round(normalizedSliderWeights.rankings * 100)}</b><input
              type="range"
              min="0"
              max="100"
              step="1"
              bind:value={sliderWeights.rankings}
            /></label
          >
        </div>
        <ol class="ranked">
          {#each autoRankedRows as team (team.key)}
            <li>
              <a href={teamHref(team.key)}>{team.team_number}</a><span class="tname"
                >{nameByTeam.get(team.key) || ''}</span
              ><small>{number(team.autoScore)}</small>
            </li>
          {/each}
        </ol>
        {#if picklistEntries.length}<button
            class="text-btn"
            on:click={seedPicklistFromAutoRank}
            disabled={picklistLoading || !autoRankedRows.length}>Replace the list with this order</button
          >{/if}
      </details>
    </aside>
  </div>
{/if}

<style>
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: var(--space-4);
    flex-wrap: wrap;
    margin-bottom: var(--space-4);
  }
  h1 {
    margin: 0;
    font-size: 1.6rem;
  }
  .sub {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover {
    color: var(--text);
    background: var(--surface-2);
  }
  .empty {
    margin: 0;
    padding: var(--space-5);
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--text-muted);
  }
  .err {
    color: var(--danger);
    border-style: solid;
  }
  .notice {
    margin: 0 0 var(--space-3);
    color: var(--text-muted);
    font-size: 0.88rem;
  }
  .text-btn {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
    text-align: left;
  }
  .text-btn:hover {
    text-decoration: underline;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 17rem;
    gap: var(--space-5);
    align-items: start;
  }
  .board {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .cols,
  .row {
    display: grid;
    /* Stat columns are sized to fit their header label ("Driving", "Scouted") so labels never run together. */
    grid-template-columns:
      1.5rem 1.8rem minmax(10rem, 1.6fr) 3.6rem 4.6rem 4.2rem 3.2rem 4.2rem 4rem 3.6rem 4.2rem
      minmax(7rem, 1fr) 1.8rem;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
  }
  .cols {
    height: 2.2rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.7rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  /* Header labels keep the header's small size (.num below sets row values to 0.92rem) and can never spill
     into the next column. */
  .cols > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cols > .num {
    font-size: inherit;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    min-height: 2.9rem;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    background: var(--surface-1);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .row.above {
    border-left-color: var(--accent);
  }
  .grip {
    display: grid;
    place-items: center;
    color: var(--text-muted);
    cursor: grab;
    touch-action: none;
  }
  .grip:active {
    cursor: grabbing;
  }
  .pos {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .team {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .team a {
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
    font-variant-numeric: tabular-nums;
  }
  .team a:hover {
    text-decoration: underline;
  }
  .tname {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
  }
  .flag {
    display: inline-grid;
    place-items: center;
    color: var(--text-muted);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-size: 0.92rem;
  }
  .num small {
    margin-left: 0.3rem;
    color: var(--text-muted);
    font-size: 0.76rem;
  }
  .num.warn {
    color: var(--text);
    font-weight: 700;
  }
  .note {
    min-width: 0;
    padding: 0.3rem 0.5rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
  }
  .note:hover {
    border-color: var(--border);
  }
  .note:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface-2);
  }
  .rm {
    display: grid;
    place-items: center;
    width: 1.8rem;
    height: 1.8rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    opacity: 0;
  }
  .row:hover .rm,
  .rm:focus-visible {
    opacity: 1;
  }
  .rm:hover {
    color: var(--text);
    background: var(--surface-3);
  }

  .auto {
    position: sticky;
    top: var(--space-4);
    padding: var(--space-4);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .auto summary {
    cursor: pointer;
    font-weight: 600;
    margin-bottom: var(--space-3);
  }
  .sliders {
    display: grid;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .sliders label {
    display: grid;
    grid-template-columns: 1fr auto;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }
  .sliders b {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .sliders input {
    grid-column: 1 / -1;
    width: 100%;
    accent-color: var(--accent);
  }
  .ranked {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    max-height: 26rem;
    overflow-y: auto;
    counter-reset: r;
  }
  .ranked li {
    display: grid;
    grid-template-columns: 1.6rem 3rem minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: baseline;
    padding: 3px 0;
    counter-increment: r;
    font-size: 0.88rem;
  }
  .ranked li::before {
    content: counter(r);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .ranked a {
    color: var(--text);
    text-decoration: none;
    font-weight: 600;
  }
  .ranked small {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 1250px) {
    .hide-md {
      display: none;
    }
    .cols,
    .row {
      grid-template-columns:
        1.5rem 1.8rem minmax(10rem, 1.6fr)
        3.6rem 4.6rem 4.2rem 3.2rem 4.2rem 4rem 3.6rem 4.2rem 1.8rem;
    }
  }
  /* The auto-rank panel moves under the board before the board gets too narrow for its columns. */
  @media (max-width: 1150px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .auto {
      position: static;
    }
  }
  /* Phone: each team is a card. Top line: drag grip, position, team, remove. Then every stat
     as a labelled chip (none are hidden any more), then the note. */
  @media (max-width: 700px) {
    .cols {
      display: none;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px var(--space-2);
      padding: var(--space-2) var(--space-2) var(--space-3);
    }
    /* The grip is the drag handle on touch: no text selection, no page scroll while dragging. */
    .grip {
      width: var(--tap-min);
      height: var(--tap-min);
      margin: -4px 0 -4px -4px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    .pos {
      min-width: 1.6rem;
      font-family: var(--font-mono);
      font-weight: 600;
    }
    /* The min-width leaves no room for a stat chip on the top line, so the chips always start below the team
       instead of squeezing its name into a sliver. */
    .team {
      flex: 1 1 0;
      min-width: 9rem;
      font-size: 1.05rem;
    }
    .team a {
      font-family: var(--font-mono);
      font-size: 1.15rem;
    }
    .rm {
      width: var(--tap-min);
      height: var(--tap-min);
      opacity: 1;
    }
    .num,
    .num.hide-sm {
      order: 1;
      display: grid;
      flex: 1 1 calc(25% - var(--space-2));
      min-width: 4.2rem;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      text-align: left;
      font-family: var(--font-mono);
      font-size: 0.95rem;
    }
    .num::before {
      content: attr(data-label);
      font-family: var(--font-body);
      font-size: var(--text-min);
      color: var(--text-muted);
    }
    .num small {
      margin-left: 0;
    }
    .num.warn {
      background: color-mix(in srgb, var(--warning) 18%, var(--surface-2));
    }
    .note,
    .note.hide-md {
      order: 2;
      display: block;
      flex: 1 1 100%;
      min-height: var(--tap-min);
      border-color: var(--border);
      background: var(--surface-1);
      font-size: 1rem;
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .tname {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
  .col-notes {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: max(var(--font-xs), var(--text-min));
    line-height: 1.5;
  }
</style>

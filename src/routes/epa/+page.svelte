<script>
  import Select from '$lib/components/common/Select.svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { TrendingUp, Calendar, MapPin, Sparkles, RefreshCw, Target } from 'lucide-svelte';
  import { fetchActiveScoutingEventKey, fetchAvailableScoutingEvents } from '$lib/scouting/scoutingEvent.js';
  import {
    computeEventEpa,
    winProbability,
    fitEpaParameters,
    evaluateEpaModel,
    predictAllianceScore
  } from '$lib/matches/epaModel.js';
  import { isPhone } from '$lib/stores/device.js';
  import SeasonFilter from '$lib/components/common/SeasonFilter.svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';

  // EPA from raw TBA match scores, anchored to our own match scouting
  // (#171): each team's rating is fitted over every played match and pulled
  // toward what the scouts saw (see src/lib/matches/epaModel.js and
  // docs/analysis/epa.md). Without scouting access it falls back to scores
  // alone. Uses only existing /api routes.

  let eventKey = '';
  let selectedEventKey = null;
  let availableEvents = [];
  let eventInfo = null;
  let eventTeams = [];

  let loading = true;
  let error = '';
  let loadedEventKey = null;

  let matches = [];
  let oprRows = [];
  let epaByTeam = new Map();
  let epaFit = null;
  let epaEvaluation = null;
  // The same back-test with scouting switched off, so the Accuracy tab can
  // show what scouting adds. Null when there is no scouting to compare.
  let scoresOnlyEvaluation = null;
  let scoutEntries = [];
  let matchRankings = [];

  const VALID_SUBTABS = ['rankings', 'events', 'predict', 'accuracy'];
  const requestedSubtab = $page.url.searchParams.get('tab');
  let activeSubtab = VALID_SUBTABS.includes(requestedSubtab) ? requestedSubtab : 'rankings';

  function setActiveSubtab(subtab) {
    if (!VALID_SUBTABS.includes(subtab)) return;
    activeSubtab = subtab;
    const url = new URL($page.url);
    url.searchParams.set('tab', subtab);
    void goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  let predictMatchKey = '';
  let predictRedKey = '';
  let predictBlueKey = '';

  $: resolvedEventKey = selectedEventKey || eventKey;
  $: activeEventLabel = availableEvents.find((option) => option.value === eventKey)?.label || eventKey || 'not set';
  $: browseEventOptions = availableEvents.filter((option) => option.value !== eventKey);

  const teamNumber = (key) => String(key || '').replace(/^frc/i, '');
  const points = (value) => (Number.isFinite(value) ? value.toFixed(1) : '—');
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');
  const metric = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.error || `Request failed (${response.status})`);
    return payload.data;
  }

  async function loadEvent() {
    if (!resolvedEventKey) {
      loading = false;
      return;
    }
    loadedEventKey = resolvedEventKey;
    loading = true;
    error = '';
    try {
      const [matchData, oprData, infoData, teamsData, scoutingReport, rankingData] = await Promise.all([
        fetchJson(`/api/tba/event-matches?event_key=${encodeURIComponent(resolvedEventKey)}&comp_level=all`),
        fetchJson(`/api/tba/event-oprs?event_key=${encodeURIComponent(resolvedEventKey)}`),
        fetchJson(`/api/tba/event-info?event_key=${encodeURIComponent(resolvedEventKey)}`).catch(() => null),
        fetchJson(`/api/tba/event-teams?event_key=${encodeURIComponent(resolvedEventKey)}`).catch(() => []),
        // Scouting makes the ratings better but is optional: anyone without
        // scouting access still gets EPA from scores alone.
        getAuthHeader()
          .then((headers) =>
            fetchJson(`/api/scouting-report?event_key=${encodeURIComponent(resolvedEventKey)}`, { headers })
          )
          .catch(() => null),
        // The scouts' best-to-worst match rankings, also optional.
        getAuthHeader()
          .then((headers) =>
            fetchJson(`/api/scouting-match-rankings?event_key=${encodeURIComponent(resolvedEventKey)}`, { headers })
          )
          .catch(() => [])
      ]);
      matches = matchData || [];
      oprRows = oprData || [];
      eventInfo = infoData;
      eventTeams = teamsData || [];
      scoutEntries = scoutingReport?.match_entries || [];
      matchRankings = rankingData || [];
      // The scale is fitted by back-testing the played matches (each one
      // predicted only from earlier matches and earlier scouting).
      epaFit = fitEpaParameters(matches, { scoutEntries, matchRankings });
      epaByTeam = computeEventEpa(matches, { scoutEntries, matchRankings });
      epaEvaluation = evaluateEpaModel(matches, { scoutEntries, matchRankings, scale: epaFit.scale });
      scoresOnlyEvaluation = scoutEntries.length
        ? evaluateEpaModel(matches, {
            useScouting: false,
            scale: fitEpaParameters(matches, { useScouting: false }).scale
          })
        : null;
      if (!predictMatchKey) {
        const upcoming = matches.find((m) => !m.actual_time) || matches[matches.length - 1];
        if (upcoming) selectMatchForPredict(upcoming.key);
      }
    } catch (exception) {
      error = exception?.message || 'Could not load EPA data for that event.';
      matches = [];
      oprRows = [];
      epaByTeam = new Map();
      epaFit = null;
      epaEvaluation = null;
      scoresOnlyEvaluation = null;
      scoutEntries = [];
    } finally {
      loading = false;
    }
  }

  function selectMatchForPredict(matchKey) {
    predictMatchKey = matchKey;
    const match = matches.find((m) => m.key === matchKey);
    predictRedKey = '';
    predictBlueKey = '';
    if (match) return; // alliance strength comes from the match's own teams, see predictedMatch below
  }

  $: predictedFromSchedule = matches.find((m) => m.key === predictMatchKey) || null;
  // A match that has already been played shows its official result next to the prediction.
  $: playedResult = (() => {
    const red = predictedFromSchedule?.alliances?.red?.score;
    const blue = predictedFromSchedule?.alliances?.blue?.score;
    if (!Number.isFinite(red) || !Number.isFinite(blue) || red < 0 || blue < 0) return null;
    return { red, blue, winner: red > blue ? 'red' : blue > red ? 'blue' : 'tie' };
  })();
  $: modelPick = predictRedWinProb == null ? null : predictRedWinProb >= 0.5 ? 'red' : 'blue';
  $: manualPrediction =
    !predictedFromSchedule && predictRedKey && predictBlueKey ? { red: [predictRedKey], blue: [predictBlueKey] } : null;
  $: predictionTeams = predictedFromSchedule
    ? {
        red: predictedFromSchedule.alliances?.red?.team_keys || [],
        blue: predictedFromSchedule.alliances?.blue?.team_keys || []
      }
    : manualPrediction;

  // Each side's robots, less what the other side's defenders take off (predictAllianceScore).
  function allianceEpaTotal(teamKeys, opponentKeys) {
    if (!teamKeys.some((key) => Number.isFinite(epaByTeam.get(key)?.epa))) return null;
    return predictAllianceScore(epaByTeam, teamKeys, opponentKeys);
  }

  $: predictRedTotal = predictionTeams ? allianceEpaTotal(predictionTeams.red, predictionTeams.blue) : null;
  $: predictBlueTotal = predictionTeams ? allianceEpaTotal(predictionTeams.blue, predictionTeams.red) : null;
  // Scale comes from the back-test above (fitEpaParameters), so it is the
  // value that actually predicted this event's played matches best - not a
  // constant, and not just a guess from scoring variance alone.
  $: predictRedWinProb =
    predictRedTotal != null && predictBlueTotal != null && epaFit
      ? winProbability(predictRedTotal, predictBlueTotal, epaFit.scale)
      : null;

  $: rankingRows = oprRows
    .map((row) => {
      const teamKey = `frc${row.team}`;
      const epaRow = epaByTeam.get(teamKey);
      const totalMatches = row.wins + row.losses + row.ties;
      return {
        teamKey,
        team: row.team,
        epa: epaRow?.epa ?? null,
        opr: row.epa, // event-oprs aliases OPR as "epa" for historical reasons - see its own file header
        winPct: totalMatches ? row.wins / totalMatches : null,
        avgScore: epaRow?.avgScore ?? null,
        auto: epaRow?.components?.auto ?? null,
        teleop: epaRow?.components?.teleop ?? null,
        endgame: epaRow?.components?.endgame ?? null,
        scoutedMatches: epaRow?.scoutedMatches ?? 0,
        matches: epaRow?.matchesPlayed ?? totalMatches,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties
      };
    })
    .sort((a, b) => (b.epa ?? -Infinity) - (a.epa ?? -Infinity));

  onMount(async () => {
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    availableEvents = await fetchAvailableScoutingEvents();
    // ?event_key=2026cc opens another event directly (a shareable link to its ratings).
    const linkedEvent = String($page.url.searchParams.get('event_key') || '').trim();
    if (linkedEvent && linkedEvent !== eventKey) selectedEventKey = linkedEvent;
    await loadEvent();
  });

  $: if (resolvedEventKey && resolvedEventKey !== loadedEventKey && !loading) void loadEvent();
  $: hasComponents = rankingRows.some((row) => Number.isFinite(row.auto));
</script>

<svelte:head><title>EPA</title></svelte:head>

<div class="epa-page">
  <div class="page-header">
    <div>
      <h1><TrendingUp size={22} /> EPA</h1>
      <p>
        Our own Expected Points Added rating: each team's share of its alliance's score, fitted from official match
        scores and anchored to our match scouting.
      </p>
    </div>
    <div class="header-actions with-select">
      <SeasonFilter
        options={browseEventOptions}
        bind:value={selectedEventKey}
        allLabel={`Current Event (${activeEventLabel})`}
      />
      <button class="btn btn-outline" on:click={loadEvent} disabled={loading || !resolvedEventKey}
        ><RefreshCw size={16} /> Refresh</button
      >
    </div>
  </div>

  {#if !resolvedEventKey}
    <div class="empty-state">Set an active scouting event in Scouting Admin to compute EPA here.</div>
  {:else if loading}
    <div class="empty-state">Loading {resolvedEventKey}...</div>
  {:else if error}
    <div class="notice notice-error">{error}</div>
  {:else}
    <div class="subtab-strip" role="tablist">
      <button class="subtab" class:active={activeSubtab === 'rankings'} on:click={() => setActiveSubtab('rankings')}
        ><TrendingUp size={14} /> Rankings</button
      >
      <button class="subtab" class:active={activeSubtab === 'events'} on:click={() => setActiveSubtab('events')}
        ><Calendar size={14} /> Events</button
      >
      <button class="subtab" class:active={activeSubtab === 'predict'} on:click={() => setActiveSubtab('predict')}
        ><Sparkles size={14} /> Predict</button
      >
      <button class="subtab" class:active={activeSubtab === 'accuracy'} on:click={() => setActiveSubtab('accuracy')}
        ><Target size={14} /> Accuracy</button
      >
    </div>

    {#if activeSubtab === 'rankings'}
      {#if !rankingRows.length}
        <div class="empty-state">No OPR/ranking data published yet for {resolvedEventKey}.</div>
      {:else if $isPhone}
        <!-- Phone (#124): one dense row per team instead of a card per row. -->
        <ol class="ph-epa">
          {#each rankingRows as row, index}
            <li>
              <a
                href={`/teamview?team=${encodeURIComponent(teamNumber(row.teamKey))}&event_key=${encodeURIComponent(resolvedEventKey)}&from=/epa&fromLabel=EPA`}
              >
                <span class="ph-rank">{index + 1}</span>
                <span class="ph-team"
                  ><b>{row.team}</b><small
                    >OPR {points(row.opr)} · {row.wins}-{row.losses}-{row.ties} · {pct(row.winPct)}</small
                  >{#if hasComponents}<small
                      >Auto {points(row.auto)} · Teleop {points(row.teleop)} · Endgame {points(row.endgame)}</small
                    >{/if}<small
                    >{row.scoutedMatches ? `Scouted in ${row.scoutedMatches} matches` : 'Not scouted yet'}</small
                  ></span
                >
                <span class="ph-epa-val"><b>{points(row.epa)}</b><small>EPA</small></span>
              </a>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="tba-table-wrap">
          <table class="tba-table">
            <thead>
              <tr
                ><th>Rank</th><th>Team</th><th>EPA</th>{#if hasComponents}<th>Auto</th><th>Teleop</th><th>Endgame</th
                  >{/if}<th>Scouted</th><th>OPR</th><th>Win%</th><th>Avg Score</th><th>Matches</th><th>Record</th></tr
              >
            </thead>
            <tbody>
              {#each rankingRows as row, index}
                <tr>
                  <td>{index + 1}</td>
                  <td
                    ><a
                      href={`/teamview?team=${encodeURIComponent(teamNumber(row.teamKey))}&event_key=${encodeURIComponent(resolvedEventKey)}&from=/epa&fromLabel=EPA`}
                      >#{row.team}</a
                    ></td
                  >
                  <td class="strong">{points(row.epa)}</td>
                  {#if hasComponents}
                    <td>{points(row.auto)}</td>
                    <td>{points(row.teleop)}</td>
                    <td>{points(row.endgame)}</td>
                  {/if}
                  <td>{row.scoutedMatches ? `${row.scoutedMatches} matches` : '—'}</td>
                  <td>{points(row.opr)}</td>
                  <td>{pct(row.winPct)}</td>
                  <td>{points(row.avgScore)}</td>
                  <td>{row.matches}</td>
                  <td class="mono">{row.wins}-{row.losses}-{row.ties}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {:else if activeSubtab === 'events'}
      <div class="event-card">
        <h2>{eventInfo?.name || resolvedEventKey}</h2>
        <div class="event-meta">
          {#if eventInfo?.start_date}<span><Calendar size={13} /> {eventInfo.start_date} – {eventInfo.end_date}</span
            >{/if}
          {#if eventInfo?.city || eventInfo?.state_prov}<span
              ><MapPin size={13} /> {[eventInfo?.city, eventInfo?.state_prov].filter(Boolean).join(', ')}</span
            >{/if}
          <span>{eventTeams.length} teams</span>
          <span>{matches.filter((m) => m.actual_time).length} of {matches.length} matches played</span>
        </div>
        <p class="tba-muted">Rankings and Predict both use this event. Switch events with the picker above.</p>
      </div>
    {:else if activeSubtab === 'predict'}
      <div class="predict-card">
        <div class="form-group">
          <label class="form-label" for="epa-predict-match">Match</label>
          <Select
            id="epa-predict-match"
            class="form-select"
            bind:value={predictMatchKey}
            on:change={() => selectMatchForPredict(predictMatchKey)}
          >
            <option value="">Pick two teams manually instead</option>
            {#each matches as match}
              <option value={match.key}
                >{String(match.comp_level || '').toUpperCase()}
                {match.match_number} - {teamNumber(match.alliances?.red?.team_keys?.[0])}/{teamNumber(
                  match.alliances?.red?.team_keys?.[1]
                )}/{teamNumber(match.alliances?.red?.team_keys?.[2])} vs {teamNumber(
                  match.alliances?.blue?.team_keys?.[0]
                )}/{teamNumber(match.alliances?.blue?.team_keys?.[1])}/{teamNumber(
                  match.alliances?.blue?.team_keys?.[2]
                )}</option
              >
            {/each}
          </Select>
        </div>

        {#if !predictedFromSchedule}
          <div class="manual-teams">
            <div class="form-group">
              <label class="form-label" for="epa-predict-red">Red team</label>
              <Select id="epa-predict-red" class="form-select" bind:value={predictRedKey}>
                <option value="">Choose a team</option>
                {#each eventTeams as team}<option value={team.key}>#{teamNumber(team.key)}</option>{/each}
              </Select>
            </div>
            <div class="form-group">
              <label class="form-label" for="epa-predict-blue">Blue team</label>
              <Select id="epa-predict-blue" class="form-select" bind:value={predictBlueKey}>
                <option value="">Choose a team</option>
                {#each eventTeams as team}<option value={team.key}>#{teamNumber(team.key)}</option>{/each}
              </Select>
            </div>
          </div>
        {/if}

        {#if predictionTeams && predictRedWinProb != null}
          <div class="predict-result">
            <div class="predict-alliance red" class:won={playedResult?.winner === 'red'}>
              <span class="predict-alliance-label"
                >Red{#if playedResult?.winner === 'red'}<span class="won-tag">Won</span>{/if}</span
              >
              {#each predictionTeams.red as key}<span class="predict-team">#{teamNumber(key)}</span>{/each}
              <strong class="predict-score">{points(predictRedTotal)}</strong>
              <span class="predict-prob">{pct(predictRedWinProb)} to win</span>
            </div>
            <div class="predict-vs">vs</div>
            <div class="predict-alliance blue" class:won={playedResult?.winner === 'blue'}>
              <span class="predict-alliance-label"
                >Blue{#if playedResult?.winner === 'blue'}<span class="won-tag">Won</span>{/if}</span
              >
              {#each predictionTeams.blue as key}<span class="predict-team">#{teamNumber(key)}</span>{/each}
              <strong class="predict-score">{points(predictBlueTotal)}</strong>
              <span class="predict-prob">{pct(1 - predictRedWinProb)} to win</span>
            </div>
          </div>
          {#if playedResult}
            <p class="predict-final" class:hit={modelPick === playedResult.winner}>
              <b
                >{playedResult.winner === 'tie' ? 'Tie' : `${playedResult.winner === 'red' ? 'Red' : 'Blue'} won`}, {playedResult.red}–{playedResult.blue}.</b
              >
              {#if playedResult.winner !== 'tie' && modelPick}
                The model {modelPick === playedResult.winner ? 'picked the winner' : 'picked the other alliance'}
                ({modelPick === 'red' ? 'Red' : 'Blue'}, {pct(
                  modelPick === 'red' ? predictRedWinProb : 1 - predictRedWinProb
                )}).
              {/if}
              <span class="tba-muted">These ratings already include this match.</span>
            </p>
          {/if}
          {#if epaFit?.tuned}
            <p class="predict-calibration tba-muted">
              Tuned on this event's {epaFit.samples} played matches - it called
              {pct(epaFit.accuracy)} of them correctly (Brier {epaFit.brier.toFixed(3)}; a coin flip scores 0.250).
              Scale {Math.round(epaFit.scale)}; {epaByTeam.scoutedTeams || 0} teams anchored to our scouting.
            </p>
          {:else}
            <p class="predict-calibration tba-muted">
              Using default settings - this event has not played enough matches yet to back-test the model against.
            </p>
          {/if}
        {:else if predictionTeams}
          <p class="tba-muted">Not enough EPA data yet for one or both alliances - they may not have played a match.</p>
        {:else}
          <p class="tba-muted">Pick a match or two teams to see a prediction.</p>
        {/if}
      </div>
    {:else}
      <section class="accuracy-section" aria-labelledby="accuracy-title">
        <div class="accuracy-heading">
          <div>
            <h2 id="accuracy-title">Model Record</h2>
            <p>
              Walk-forward results against official The Blue Alliance scores for {eventInfo?.name || resolvedEventKey}.
              Each match is predicted using only earlier event results.
            </p>
          </div>
          <span class="accuracy-source">Official results: TBA</span>
        </div>
        {#if !epaEvaluation?.samples}
          <div class="empty-state">
            The model needs more completed matches before it can produce a meaningful record.
          </div>
        {:else}
          <div class="accuracy-metrics">
            <div class="accuracy-metric">
              <span>Score error</span>
              <strong>{points(epaEvaluation.scoreMae)}</strong>
              <small>Average points off per alliance</small>
            </div>
            <div class="accuracy-metric">
              <span>Winner calls</span>
              <strong>{pct(epaEvaluation.accuracy)}</strong>
              <small>{epaEvaluation.samples} evaluated matches</small>
            </div>
            <div class="accuracy-metric">
              <span>Brier score</span>
              <strong>{metric(epaEvaluation.brier)}</strong>
              <small>Lower is better; coin flip is 0.250</small>
            </div>
            <div class="accuracy-metric">
              <span>Log loss</span>
              <strong>{metric(epaEvaluation.logLoss)}</strong>
              <small>Lower rewards well-calibrated confidence</small>
            </div>
            <div class="accuracy-metric">
              <span>Confidence margin</span>
              <strong>{metric(epaEvaluation.brierStdErr)}</strong>
              <small>Estimated uncertainty in the Brier score</small>
            </div>
          </div>
          {#if scoresOnlyEvaluation?.samples}
            <div class="accuracy-compare">
              <h3>What scouting adds</h3>
              <table class="tba-table">
                <thead><tr><th></th><th>Score error</th><th>Winner calls</th><th>Brier</th></tr></thead>
                <tbody>
                  <tr>
                    <td>Scores only</td>
                    <td>{points(scoresOnlyEvaluation.scoreMae)}</td>
                    <td>{pct(scoresOnlyEvaluation.accuracy)}</td>
                    <td>{metric(scoresOnlyEvaluation.brier)}</td>
                  </tr>
                  <tr class="strong">
                    <td>With our scouting</td>
                    <td>{points(epaEvaluation.scoreMae)}</td>
                    <td>{pct(epaEvaluation.accuracy)}</td>
                    <td>{metric(epaEvaluation.brier)}</td>
                  </tr>
                </tbody>
              </table>
              <small>Same matches, same walk-forward rules; {scoutEntries.length} scouting reports this event.</small>
            </div>
          {/if}
          <p class="accuracy-note">
            This updates as official scores arrive. The first matches are left out: before anyone has played, every
            prediction is just the prior.
          </p>
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  .epa-page {
    --home-radius: 0;
    max-width: 1100px;
    margin: var(--space-6) auto;
    padding: 0 var(--space-4);
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-bottom: var(--space-5);
  }

  .page-header h1 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }
  .page-header p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
    max-width: 42em;
  }
  .header-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .subtab-strip {
    display: flex;
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    margin-bottom: var(--space-4);
  }
  .subtab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: none;
    background: var(--surface-1);
    color: var(--text-secondary);
    font-weight: 600;
    cursor: pointer;
  }
  .subtab:hover {
    background: var(--surface-2);
  }
  .subtab.active {
    background: var(--accent-subtle);
    color: var(--secondary);
    box-shadow: inset 0 -3px 0 var(--brand-gold-strong);
  }

  .tba-table-wrap {
    overflow-x: auto;
  }
  .tba-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .tba-table th,
  .tba-table td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .tba-table th {
    color: var(--text-muted);
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.68rem;
    letter-spacing: 0.03em;
  }
  .tba-table .strong {
    font-weight: 700;
    color: var(--secondary);
  }
  .tba-table .mono {
    font-family: var(--font-mono-stack);
    color: var(--text-secondary);
  }
  .tba-table a {
    color: var(--accent-strong);
    text-decoration: none;
    font-weight: 600;
  }
  .tba-table a:hover {
    text-decoration: underline;
  }

  .event-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-left: 3px solid var(--brand-gold-strong);
    padding: var(--space-4) var(--space-5);
  }
  .event-card h2 {
    margin: 0;
    font-size: var(--font-lg);
    color: var(--secondary);
  }
  .event-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin: var(--space-3) 0;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }
  .event-meta span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }
  .tba-muted {
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  .predict-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    padding: var(--space-4) var(--space-5);
    display: grid;
    gap: var(--space-4);
  }
  .manual-teams {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
  /* Long option text must not widen the card past the screen. */
  .predict-card,
  .predict-card > *,
  .manual-teams > * {
    min-width: 0;
  }

  .predict-alliance.won {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .won-tag {
    margin-left: var(--space-2);
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 0.7rem;
    letter-spacing: 0.04em;
  }
  .predict-final {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    border-left: 3px solid var(--danger);
    background: var(--surface-2);
  }
  .predict-final.hit {
    border-left-color: var(--success);
  }
  .predict-result {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: var(--space-4);
    align-items: center;
  }
  .predict-calibration {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.5;
  }
  .predict-alliance {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-4);
  }
  .predict-alliance.red {
    background: var(--red-soft);
  }
  .predict-alliance.blue {
    background: var(--blue-soft, #e8f1ff);
  }
  .predict-alliance-label {
    font-size: var(--font-xs);
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .predict-team {
    font-weight: 600;
  }
  .predict-score {
    font-size: var(--font-xl);
  }
  .predict-prob {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .predict-vs {
    color: var(--text-muted);
    font-weight: 700;
  }

  .accuracy-section {
    display: grid;
    gap: var(--space-4);
  }
  .accuracy-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .accuracy-heading h2 {
    margin: 0;
    font-size: var(--font-lg);
  }
  .accuracy-heading p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
    max-width: 46rem;
  }
  .accuracy-source {
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .accuracy-metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
  }
  .accuracy-compare {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-4);
    overflow-x: auto;
  }
  .accuracy-compare h3 {
    margin: 0;
    font-size: 1rem;
  }
  .accuracy-compare small {
    color: var(--text-muted);
  }
  .accuracy-compare .strong td {
    font-weight: 700;
  }
  .accuracy-metric {
    min-height: 126px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-1);
  }
  .accuracy-metric span {
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .accuracy-metric strong {
    color: var(--secondary);
    font-size: var(--font-xl);
    font-variant-numeric: tabular-nums;
  }
  .accuracy-metric small,
  .accuracy-note {
    color: var(--text-muted);
    font-size: 0.78rem;
    line-height: 1.45;
  }
  .accuracy-note {
    margin: 0;
  }

  .notice {
    border: 1px solid var(--border);
    padding: var(--space-4);
  }
  .notice-error {
    border-color: var(--danger, #dc3545);
    color: var(--danger, #dc3545);
  }

  @media (max-width: 640px) {
    .predict-result {
      grid-template-columns: 1fr;
    }
    .manual-teams {
      grid-template-columns: 1fr;
    }
    .accuracy-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Phone (#124) */
  @media (max-width: 900px) {
    .epa-page .page-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }
    .epa-page .page-header > div:first-child {
      grid-column: 1 / -1;
    }
    .epa-page .header-actions {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2);
    }
    .subtab-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 2px;
      padding: 4px;
      border-radius: 12px;
      background: var(--surface-2);
      overflow: visible;
    }
    .subtab {
      display: grid;
      justify-items: center;
      gap: 2px;
      min-height: var(--tap-min);
      padding: 4px 2px;
      border-radius: 9px;
      font-size: 0.75rem;
    }
    .subtab.active {
      background: var(--surface-1);
    }
    .manual-teams {
      grid-template-columns: 1fr;
    }
    .predict-card {
      padding: var(--space-3);
      gap: var(--space-3);
    }
    .predict-result {
      grid-template-columns: 1fr auto 1fr;
      gap: var(--space-2);
    }
    .predict-alliance {
      padding: var(--space-2);
    }
    .predict-score {
      font-size: 1.6rem;
    }
    .accuracy-metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .accuracy-heading p,
    .accuracy-note,
    .accuracy-metric small {
      display: none;
    }
  }
  .ph-epa {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-1);
    overflow: hidden;
  }
  .ph-epa li + li {
    border-top: 1px solid var(--border);
  }
  .ph-epa a {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    min-height: 52px;
    padding: 6px var(--space-3);
    color: var(--text);
    text-decoration: none;
  }
  .ph-epa a:active {
    background: var(--surface-2);
  }
  .ph-rank {
    font-family: var(--font-mono);
    color: var(--text-muted);
    text-align: center;
  }
  .ph-team {
    display: grid;
    min-width: 0;
  }
  .ph-team b {
    font-family: var(--font-mono);
    font-size: 1.1rem;
  }
  .ph-team small {
    color: var(--text-muted);
    font-size: 0.75rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ph-epa-val {
    display: grid;
    justify-items: end;
  }
  .ph-epa-val b {
    font-family: var(--font-mono);
    font-size: 1.2rem;
    color: var(--accent-strong);
  }
  .ph-epa-val small {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .ph-team small {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

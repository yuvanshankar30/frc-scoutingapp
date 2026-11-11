<script>
  import { onMount } from 'svelte';
  import { ClipboardCheck, ListChecks, RefreshCw, Wrench } from 'lucide-svelte';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { userStore } from '$lib/stores/auth.js';
  import { fetchActiveScoutingEventKey } from '$lib/scouting/scoutingEvent.js';
  import { isPhone } from '$lib/stores/device.js';
  import { scoutIdentity } from '$lib/scouting/scoutIdentity.js';
  import { reportKindOf } from '$lib/scouting/reportKinds.js';

  // Opening a saved report from here loads it for editing: Match Scouting on the report's own tab
  // and event, Pit Scouting on the team's entry.
  const matchReportHref = (r) =>
    `/matchscout?match=${encodeURIComponent(matchInputValue(r.match_key))}&team=${encodeURIComponent(String(r.team_key || '').replace(/^frc/, ''))}&tab=${reportKindOf(r)}${r.event_key ? `&event_key=${encodeURIComponent(r.event_key)}` : ''}`;
  const pitReportHref = (r) =>
    `/pitscout?event_key=${encodeURIComponent(r.event_key)}&team=${encodeURIComponent(String(r.team_key || '').replace(/^frc/, ''))}`;
  import MyAssignments from '$lib/components/scouting/MyAssignments.svelte';
  import { matchLabel } from '$lib/matches/matchKeys.js';
  import { matchInputValue } from '$lib/matches/matchKeys.js';

  let user;
  userStore.subscribe((v) => (user = v));

  let eventKey = '';
  let matchReports = [];
  let pitReports = [];
  let assignmentCount = 0;
  let myAssignments;
  let loading = true;
  let error = '';

  async function load() {
    loading = true;
    error = '';
    try {
      eventKey = (await fetchActiveScoutingEventKey()) || '';
      if (!eventKey) {
        matchReports = [];
        pitReports = [];
        return;
      }
      const headers = await getAuthHeader();
      // Match Scouting already has a proven mine=1 (per-event) branch -
      // reuse it exactly rather than a new one. Pit scouting has no
      // per-scout filter server-side (one row per team, not per scout), so
      // fetch the event's roster and keep only this scout's own rows -
      // created_by is overwritten on every save, so this is "entries this
      // scout most recently touched," the best signal available.
      myAssignments?.refresh();
      const [matchRes, pitRes] = await Promise.all([
        fetch(`/api/matchscout?event_key=${encodeURIComponent(eventKey)}&mine=1`, { headers })
          .then((r) => r.json())
          .catch(() => null),
        fetch(`/pitscout?event_key=${encodeURIComponent(eventKey)}`, { headers })
          .then((r) => r.json())
          .catch(() => null)
      ]);
      matchReports = matchRes?.success ? matchRes.data || [] : [];
      pitReports = pitRes?.success ? (pitRes.data || []).filter((r) => r.created_by === user?.id) : [];
      if (!matchRes?.success && !pitRes?.success) {
        error = matchRes?.error || pitRes?.error || 'Could not load your scouting history.';
      }
    } catch (exception) {
      error = exception?.message || 'Could not load your scouting history.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const teamNumber = (key) => String(key || '').replace(/^frc/i, '');

  function fmtDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  $: teamsCovered = new Set([...matchReports, ...pitReports].map((r) => r.team_key).filter(Boolean)).size;
  $: sortedMatchReports = [...matchReports].sort((a, b) =>
    String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))
  );
  $: sortedPitReports = [...pitReports].sort((a, b) =>
    String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))
  );
  // Phone screen: one list at a time, and the scout's own name and role up top.
  let phoneTab = 'todo';
  let nextAssignment = null;
  $: me = scoutIdentity(user);
</script>

<svelte:head><title>My Scout</title></svelte:head>

{#if $isPhone}
  <!-- Phone: one screen. Header, stats and tabs stay put; only the list inside the panel scrolls. -->
  <div class="ph-my">
    <header class="ph-hello">
      <div>
        <small>{me.greeting},</small>
        <b>{me.firstName}</b>
        <span class="ph-roles"
          >{me.roles.length ? me.roles.join(' · ') : 'Scout'}{eventKey ? ` · ${eventKey}` : ''}</span
        >
      </div>
      <button type="button" class="ph-icon" on:click={load} disabled={loading} aria-label="Refresh"
        ><RefreshCw size={18} /></button
      >
    </header>

    {#if loading}
      <div class="ph-panel ph-center">Loading your scouting...</div>
    {:else if error}
      <div class="ph-panel ph-center notice-error">{error}</div>
    {:else if !eventKey}
      <div class="ph-panel ph-center">No active competition is set yet.</div>
    {:else}
      <div class="ph-stats">
        <span class:ph-hot={assignmentCount > 0}><b>{assignmentCount}</b>to do</span>
        <span><b>{matchReports.length}</b>match</span>
        <span><b>{pitReports.length}</b>pit</span>
        <span><b>{teamsCovered}</b>teams</span>
      </div>

      <div class="ph-seg" role="tablist" aria-label="Show">
        <button
          role="tab"
          aria-selected={phoneTab === 'todo'}
          class:on={phoneTab === 'todo'}
          on:click={() => (phoneTab = 'todo')}>To do</button
        >
        <button
          role="tab"
          aria-selected={phoneTab === 'match'}
          class:on={phoneTab === 'match'}
          on:click={() => (phoneTab = 'match')}>Match</button
        >
        <button
          role="tab"
          aria-selected={phoneTab === 'pit'}
          class:on={phoneTab === 'pit'}
          on:click={() => (phoneTab = 'pit')}>Pit</button
        >
      </div>

      <div class="ph-panel">
        {#if phoneTab === 'todo'}
          <div class="ph-todo">
            <MyAssignments
              bind:this={myAssignments}
              bind:count={assignmentCount}
              bind:next={nextAssignment}
              {eventKey}
            />
          </div>
        {:else if phoneTab === 'match'}
          {#if sortedMatchReports.length}
            <ul class="ph-rows">
              {#each sortedMatchReports as r (r.id)}
                <li>
                  <a href={matchReportHref(r)}>
                    <span class={`ph-dot ${r.alliance || ''}`}></span><b>{matchLabel(r.match_key)}</b><span
                      class="ph-team">{teamNumber(r.team_key)}</span
                    ><small>{fmtDate(r.updated_at || r.created_at)}</small>
                  </a>
                </li>
              {/each}
            </ul>
          {:else}<p class="ph-empty"><ClipboardCheck size={28} />No match reports yet.</p>{/if}
        {:else if sortedPitReports.length}
          <ul class="ph-rows">
            {#each sortedPitReports as r (r.event_key + '::' + r.team_key)}
              <li>
                <a href={pitReportHref(r)}>
                  <Wrench size={16} /><b>Team {teamNumber(r.team_key)}</b><span class="ph-sub"
                    >{r.robot_archetype || r.drivebase_type || 'Pit report'}</span
                  ><small>{fmtDate(r.updated_at || r.created_at)}</small>
                </a>
              </li>
            {/each}
          </ul>
        {:else}<p class="ph-empty"><Wrench size={28} />No pit reports yet.</p>{/if}
      </div>

      {#if nextAssignment}
        <a class="ph-cta" href={nextAssignment.href}
          >Start next: {nextAssignment.role} · {nextAssignment.matchLabel} · {nextAssignment.team}</a
        >
      {:else}
        <a class="ph-cta ghost" href="/matchscout">Scout a match</a>
      {/if}
    {/if}
  </div>
{:else}
  <div class="myscout-page">
    <header class="myscout-header">
      <div>
        <h1><ClipboardCheck size={22} /> My Scout</h1>
        <p>Every match and pit report you've personally submitted for the active competition.</p>
      </div>
      <button class="btn btn-outline" on:click={load} disabled={loading}><RefreshCw size={16} /> Refresh</button>
    </header>

    {#if loading}
      <div class="empty-state">Loading your scouting history...</div>
    {:else if error}
      <div class="notice notice-error">{error}</div>
    {:else if !eventKey}
      <div class="empty-state">
        No active competition is set. Set one in <a href="/scouting-admin">Scouting Admin</a> to see your scouting history
        here.
      </div>
    {:else}
      <div class="stat-strip">
        <div class="stat-tile">
          <span class="stat-label">Competition</span>
          <strong class="stat-value stat-value-text">{eventKey}</strong>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Match Reports</span>
          <strong class="stat-value">{matchReports.length}</strong>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Pit Reports</span>
          <strong class="stat-value">{pitReports.length}</strong>
        </div>
        <div class="stat-tile">
          <span class="stat-label">Teams Covered</span>
          <strong class="stat-value">{teamsCovered}</strong>
        </div>
      </div>

      <section class="assignment-section" aria-labelledby="assignment-heading">
        <div class="section-heading">
          <div>
            <h2 id="assignment-heading"><ListChecks size={18} /> Upcoming Assignments</h2>
            <p class="muted">
              {assignmentCount
                ? `${assignmentCount} open scouting assignment${assignmentCount === 1 ? '' : 's'}, next match first`
                : 'Assignments you have not completed yet show up here.'}
            </p>
          </div>
        </div>
        <MyAssignments bind:this={myAssignments} bind:count={assignmentCount} {eventKey} />
      </section>

      <section class="report-section">
        <h2><ClipboardCheck size={18} /> Match Reports</h2>
        {#if sortedMatchReports.length === 0}
          <p class="muted">
            No match reports submitted yet. Head to <a href="/matchscout">Match Scouting</a> to start one.
          </p>
        {:else}
          <div class="report-grid">
            {#each sortedMatchReports as r (r.id)}
              <a class="report-card" href={matchReportHref(r)}>
                <span class="report-event">{r.event_key}</span>
                <h4>{matchLabel(r.match_key)} &middot; Team {teamNumber(r.team_key)}</h4>
                <p class="muted">
                  {#if r.alliance}<span
                      class="alliance-chip"
                      class:red={r.alliance === 'red'}
                      class:blue={r.alliance === 'blue'}>{r.alliance}</span
                    >{/if}
                  {fmtDate(r.updated_at || r.created_at)}
                </p>
              </a>
            {/each}
          </div>
        {/if}
      </section>

      <section class="report-section">
        <h2><Wrench size={18} /> Pit Scouting Reports</h2>
        {#if sortedPitReports.length === 0}
          <p class="muted">
            No pit scouting reports submitted yet. Head to <a href="/pitscout">Pit Scouting</a> to start one.
          </p>
        {:else}
          <div class="report-grid">
            {#each sortedPitReports as r (r.event_key + '::' + r.team_key)}
              <a class="report-card pit" href={pitReportHref(r)}>
                <span class="report-event">{r.event_key}</span>
                <h4>Team {teamNumber(r.team_key)}</h4>
                <p class="muted">
                  {r.robot_archetype || r.drivebase_type || 'Pit report'} &middot; {fmtDate(
                    r.updated_at || r.created_at
                  )}
                </p>
              </a>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  .myscout-page {
    --home-radius: 0;
    max-width: 1200px;
    margin: var(--space-7) auto;
    padding: 0 var(--space-4);
  }

  .myscout-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-4);
    flex-wrap: wrap;
    margin-bottom: var(--space-5);
  }

  .myscout-header h1 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }

  .myscout-header p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
  }

  .stat-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    margin-bottom: var(--space-6);
  }

  .stat-tile {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    background: var(--surface-1);
    padding: var(--space-4) var(--space-5);
  }

  .stat-label {
    font-family: var(--font-mono-stack);
    font-size: var(--font-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .stat-value {
    font-size: var(--font-xxl, 1.75rem);
    font-weight: 700;
    color: var(--secondary);
    line-height: 1.1;
  }

  .stat-value-text {
    font-size: var(--font-lg);
    font-family: var(--font-mono-stack);
    text-transform: uppercase;
  }

  .report-section {
    margin-bottom: var(--space-7);
  }

  .assignment-section {
    margin-bottom: var(--space-6);
  }

  .section-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .section-heading h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--secondary);
    font-size: var(--font-lg);
  }

  .section-heading p {
    margin: var(--space-1) 0 0;
  }

  .report-section h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    color: var(--secondary);
    font-size: var(--font-lg);
  }

  .report-section .muted {
    color: var(--text-secondary);
  }

  .report-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--gap-3);
  }

  .report-card {
    display: block;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-left: 3px solid var(--brand-gold-strong);
    padding: var(--space-4) var(--space-5);
    text-decoration: none;
    color: inherit;
    transition:
      border-color 0.1s ease,
      background-color 0.1s ease;
  }

  .report-card.pit {
    border-left-color: var(--accent-strong, #4a6fa5);
  }

  .report-card:hover {
    background: var(--surface-2);
    border-color: var(--accent-strong);
  }

  .report-event {
    display: block;
    font-family: var(--font-mono-stack);
    font-size: var(--font-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: var(--space-1);
  }

  .report-card h4 {
    margin: 0 0 var(--space-1) 0;
    color: var(--secondary);
    font-size: var(--font-md);
  }

  .report-card p {
    margin: 0;
    font-size: var(--font-xs);
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .alliance-chip {
    text-transform: uppercase;
    font-size: var(--font-xs);
    font-weight: 700;
    padding: 1px 6px;
  }

  .alliance-chip.red {
    color: var(--red-strong);
    background: var(--red-soft);
  }
  .alliance-chip.blue {
    color: var(--blue-strong, #174ea6);
    background: var(--blue-soft, #e8f1ff);
  }

  .empty-state,
  .notice {
    border: 1px solid var(--border);
    padding: var(--space-4);
    color: var(--text-secondary);
  }

  .notice-error {
    border-color: var(--danger, #dc3545);
    color: var(--danger, #dc3545);
  }

  @media (max-width: 600px) {
    .myscout-header {
      flex-direction: column;
      align-items: stretch;
    }
  }

  /* Phone: exactly one screen tall; only .ph-panel scrolls. */
  .ph-my {
    height: var(--screen-avail);
    min-height: 24rem;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    gap: clamp(8px, 1.4 * var(--vh), 14px);
  }
  .ph-hello {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .ph-hello div {
    display: grid;
    min-width: 0;
  }
  .ph-hello small {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .ph-hello b {
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 4.2 * var(--vh), 2.2rem);
    line-height: 1.05;
  }
  .ph-roles {
    margin-top: 4px;
    color: var(--accent-strong);
    font-size: 0.82rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ph-icon {
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    color: var(--text-secondary);
  }
  .ph-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .ph-stats span {
    display: grid;
    justify-items: center;
    padding: clamp(6px, 1.2 * var(--vh), 10px) 4px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface-1);
    font-size: 0.72rem;
    color: var(--text-secondary);
  }
  .ph-stats b {
    font-family: var(--font-mono);
    font-size: clamp(1.1rem, 2.8 * var(--vh), 1.5rem);
    color: var(--text);
  }
  .ph-stats .ph-hot {
    border-color: var(--accent);
  }
  .ph-seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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
  .ph-panel {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface-1);
  }
  .ph-center {
    display: grid;
    place-items: center;
    padding: var(--space-4);
    color: var(--text-secondary);
    text-align: center;
  }
  .ph-rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .ph-rows li + li {
    border-top: 1px solid var(--border);
  }
  .ph-rows a {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: 'icon main team' 'icon sub when';
    align-items: center;
    column-gap: var(--space-3);
    row-gap: 2px;
    min-height: 56px;
    padding: var(--space-2) var(--space-3);
    color: var(--text);
    text-decoration: none;
  }
  .ph-rows a:active {
    background: var(--surface-2);
  }
  .ph-rows a > :global(svg),
  .ph-dot,
  .ph-kind {
    grid-area: icon;
  }
  .ph-rows b {
    grid-area: main;
    font-weight: 600;
  }
  .ph-team {
    grid-area: team;
    font-family: var(--font-mono);
    font-size: 1.1rem;
    font-weight: 600;
  }
  .ph-rows small {
    grid-area: when;
    color: var(--text-muted);
    font-size: 0.75rem;
    justify-self: end;
  }
  .ph-rows .ph-sub {
    grid-area: sub;
    color: var(--text-secondary);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ph-todo {
    padding: var(--space-2);
  }
  .ph-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--surface-3);
  }
  .ph-dot.red {
    background: var(--red-base);
  }
  .ph-dot.blue {
    background: var(--blue-base);
  }
  .ph-empty {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-6) var(--space-4);
    color: var(--text-secondary);
    text-align: center;
  }
  .ph-empty :global(svg) {
    color: var(--text-muted);
  }
  .ph-cta {
    display: grid;
    place-items: center;
    min-height: var(--tap-comfort);
    border-radius: 12px;
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 700;
    text-decoration: none;
  }
  .ph-cta.ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text);
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .assignment-type,
    .ph-roles,
    .ph-rows .ph-sub {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

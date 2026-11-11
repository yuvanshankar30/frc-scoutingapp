<script>
  // One team's strategy brief, laid out like Team View: who they are, the numbers that decide a match, how they
  // did match by match, what is coming up, and every scouting report by kind. Strategy shows it beside the team
  // list on desktop and in a bottom sheet on phones; the layout reflows by its own width, not the screen's.
  import { AlertTriangle, ExternalLink } from 'lucide-svelte';
  import MatchScoutReport from '$lib/components/scouting/MatchScoutReport.svelte';
  import { reportKindOf } from '$lib/scouting/reportKinds.js';
  import { ACCURACY_LABELS, BPS_LABELS } from '$lib/scouting/matchScouting.js';
  import { compareMatchKeys, shortMatchLabel } from '$lib/matches/matchKeys.js';

  export let row;
  export let stats;
  export let name = '';
  export let timeline = [];
  // [{ match, alliance, projection }] for this team's next matches.
  export let upcoming = [];
  export let teamHref = '';
  export let teamCount = 0;
  export let onSelectTeam = null;
  export let showHeader = true;

  const REPORTS_SHOWN = 3;
  const KIND_TABS = { data: 'Data', performance: 'Performance', robot: 'Robot' };
  let kindTab = 'data';
  let showAllReports = false;
  $: if (row) showAllReports = false;

  const team = (key) => String(key || '').replace(/^frc/i, '');
  const one = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : '—');
  const whole = (value) => (Number.isFinite(value) ? Math.round(value).toString() : '—');
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—');
  const bandLabel = (labels, rating) =>
    Number.isFinite(rating) ? labels[Math.min(labels.length, Math.max(1, Math.round(rating))) - 1] : 'Not rated';
  const listOrText = (value) => (Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value ?? '').trim());

  const PIT_FIELDS = [
    ['Archetype', 'robot_archetype'],
    ['Drivetrain', 'drivebase_type'],
    ['Shooter', 'shooter_type'],
    ['Hopper', 'hopper_type'],
    ['Estimated BPS', 'estimated_bps'],
    ['Auto points (pit)', 'auto_points_estimate'],
    ['Autos', 'auto_options'],
    ['Climb', 'climb_options'],
    ['Likely to break', 'likely_breaking_component']
  ];
  $: pitRows = row?.pitEntry
    ? PIT_FIELDS.map(([label, field]) => [label, listOrText(row.pitEntry[field])]).filter(([, value]) => value)
    : [];
  $: reportsByKind = Object.fromEntries(
    ['data', 'performance', 'robot'].map((kind) => [
      kind,
      (row?.matchEntries || [])
        .filter((entry) => reportKindOf(entry) === kind)
        .sort((a, b) => compareMatchKeys(b.match_key, a.match_key))
    ])
  );
  $: shownReports = showAllReports ? reportsByKind[kindTab] : reportsByKind[kindTab].slice(0, REPORTS_SHOWN);
  // With nothing left to play, the card shows the last results instead.
  $: recent = timeline
    .filter((entry) => entry.played)
    .slice(-4)
    .reverse();
  $: maxPoints = Math.max(1, ...timeline.map((entry) => entry.points ?? 0));
  $: roleEntries = Object.entries(stats?.roles || {}).sort((a, b) => b[1] - a[1]);
  $: roleTotal = roleEntries.reduce((sum, [, count]) => sum + count, 0);
  $: reliability = Number.isFinite(stats?.incidentRate) ? 1 - stats.incidentRate : null;
</script>

{#if row && stats}
  <div class="brief">
    {#if showHeader}
      <header class="hero">
        <div class="hero-id">
          <span class="number">{row.teamNumber}</span>
          <div>
            <h2>{name || `Team ${row.teamNumber}`}</h2>
            <p>{row.pitEntry?.robot_archetype || 'No pit profile yet'}</p>
          </div>
        </div>
        <div class="hero-chips">
          <span class="chip"><small>Event rank</small><b>{stats.rank ? `#${stats.rank}` : '—'}</b></span>
          <span class="chip"><small>Record</small><b>{stats.record || '—'}</b></span>
          <span class="chip"
            ><small>EPA rank</small><b>{stats.epaRank ? `#${stats.epaRank} of ${teamCount}` : '—'}</b></span
          >
          {#if teamHref}<a class="btn btn-outline btn-sm" href={teamHref}>Team view <ExternalLink size={14} /></a>{/if}
        </div>
      </header>
    {/if}

    <section class="metrics" aria-label="Key numbers">
      <div class="metric">
        <span class="k">EPA</span>
        <strong>{one(stats.epa)}</strong>
        <small>Auto {one(stats.auto)} · Teleop {one(stats.teleop)} · Endgame {one(stats.endgame)}</small>
      </div>
      <div class="metric">
        <span class="k">Scouted fuel</span>
        <strong>{whole(stats.fuel)}</strong>
        <small>balls per match</small>
      </div>
      <div class="metric">
        <span class="k">Auto points</span>
        <strong>{whole(stats.autoPoints)}</strong>
        <small>auto ran {pct(stats.autoRunRate)}</small>
      </div>
      <div class="metric">
        <span class="k">Shot accuracy</span>
        <strong>{one(stats.accuracy)}</strong>
        <small>{bandLabel(ACCURACY_LABELS, stats.accuracy)}</small>
      </div>
      <div class="metric">
        <span class="k">BPS</span>
        <strong>{one(stats.bps)}</strong>
        <small>{bandLabel(BPS_LABELS, stats.bps)}</small>
      </div>
      <div class="metric">
        <span class="k">Driver skill</span>
        <strong>{one(stats.driver)}</strong>
        <small>out of 5</small>
      </div>
      <div class="metric" class:warn={Number.isFinite(reliability) && reliability < 0.85}>
        <span class="k">Reliability</span>
        <strong>{pct(reliability)}</strong>
        <small>matches without a break, crash or no-show</small>
      </div>
      <div class="metric">
        <span class="k">Coverage</span>
        <strong>{stats.matchesScouted}</strong>
        <small>Data {stats.kinds.data} · Perf {stats.kinds.performance} · Robot {stats.kinds.robot}</small>
      </div>
    </section>

    <div class="two">
      <section class="card" aria-labelledby="perf-title">
        <div class="card-head">
          <h3 id="perf-title">Performance scouting</h3>
          <span class="count">{stats.performance.reports} reports</span>
        </div>
        {#if stats.performance.reports || stats.powerRank != null}
          <dl class="facts">
            <div>
              <dt>Power rank</dt>
              <dd>
                {stats.powerRank == null ? '—' : `#${one(stats.powerRank)}`}<small
                  >{stats.powerRankMatches
                    ? `avg place in ${stats.powerRankMatches} matches (1 = best)`
                    : 'not ranked yet'}</small
                >
              </dd>
            </div>
            <div>
              <dt>Offense</dt>
              <dd>{one(stats.performance.offense)}<small>out of 5</small></dd>
            </div>
            <div>
              <dt>Defense</dt>
              <dd>{one(stats.performance.defense)}<small>out of 5</small></dd>
            </div>
            <div>
              <dt>Intake speed</dt>
              <dd>{one(stats.performance.intake)}<small>out of 5</small></dd>
            </div>
          </dl>
        {:else}<p class="muted">No Performance reports for this team yet.</p>{/if}
      </section>

      <section class="card" aria-labelledby="robot-title">
        <div class="card-head">
          <h3 id="robot-title">Robot scouting</h3>
          <span class="count">{stats.robot.matches} matches watched</span>
        </div>
        {#if stats.robot.reports}
          <dl class="facts">
            <div class:bad={stats.robot.breaks}>
              <dt>Mechanical breaks</dt>
              <dd>{stats.robot.breaks}</dd>
            </div>
            <div class:bad={stats.robot.stopped}>
              <dt>Dead or stopped</dt>
              <dd>{stats.robot.stopped}</dd>
            </div>
            <div class:bad={stats.robot.crashes}>
              <dt>Big crashes</dt>
              <dd>{stats.robot.crashes}</dd>
            </div>
            <div class:bad={stats.robot.beached}>
              <dt>Beached</dt>
              <dd>{stats.robot.beached}</dd>
            </div>
            <div class:bad={stats.robot.jams}>
              <dt>Intake jams</dt>
              <dd>{stats.robot.jams}</dd>
            </div>
            <div class:bad={stats.robot.noShows}>
              <dt>No-shows</dt>
              <dd>{stats.robot.noShows}</dd>
            </div>
            <div class:bad={stats.robot.cards}>
              <dt>Cards</dt>
              <dd>{stats.robot.cards}</dd>
            </div>
            <div>
              <dt>Fouls per match</dt>
              <dd>{one(stats.robot.foulsPerMatch)}</dd>
            </div>
          </dl>
        {:else}<p class="muted">No Robot reports for this team yet.</p>{/if}
      </section>
    </div>

    <section class="card" aria-labelledby="timeline-title">
      <div class="card-head">
        <h3 id="timeline-title">Match by match</h3>
        <span class="legend"
          ><i class="dot ok"></i>Scouted points <i class="dot incident"></i>Incident
          <i class="dot noshow"></i>No-show</span
        >
      </div>
      {#if !timeline.length}
        <p class="muted">No matches on the schedule yet.</p>
      {:else}
        <div class="timeline" role="list">
          {#each timeline as entry (entry.matchKey)}
            <div
              class="col"
              role="listitem"
              aria-label={`${entry.label}: ${entry.points == null ? 'not scouted' : `${Math.round(entry.points)} scouted points`}${entry.result ? `, ${entry.result} ${entry.score}-${entry.opponentScore}` : ''}`}
            >
              <span class="val">{entry.noShow ? '0' : whole(entry.points)}</span>
              <span class="track"
                ><span
                  class="bar"
                  class:incident={entry.incident && !entry.noShow}
                  class:noshow={entry.noShow}
                  class:empty={entry.points == null}
                  style={`height:${entry.points == null ? 4 : Math.max(4, (entry.points / maxPoints) * 100)}%`}
                ></span></span
              >
              <span class="lab">{entry.label}</span>
              <span class="res {entry.result || 'upcoming'} {entry.side}"
                >{entry.result ? entry.result[0].toUpperCase() : '·'}</span
              >
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <div class="two">
      <section class="card" aria-labelledby="upcoming-title">
        <div class="card-head">
          <h3 id="upcoming-title">{upcoming.length ? 'Next matches' : 'Last results'}</h3>
        </div>
        {#if !upcoming.length}
          {#if recent.length}
            <ul class="upcoming">
              {#each recent as entry (entry.matchKey)}
                <li class={entry.side}>
                  <div class="up-top">
                    <b>{entry.label}</b>
                    <span class="outcome {entry.result}"
                      >{entry.result === 'win' ? 'Won' : entry.result === 'loss' ? 'Lost' : 'Tied'}
                      {entry.score}–{entry.opponentScore}</span
                    >
                  </div>
                  <span class="muted"
                    >{entry.noShow
                      ? 'Did not show up'
                      : entry.points == null
                        ? 'Not scouted'
                        : `${Math.round(entry.points)} scouted points${entry.incident ? ' · incident' : ''}`}</span
                  >
                </li>
              {/each}
            </ul>
          {:else}<p class="muted">No matches played or scheduled yet.</p>{/if}
        {:else}
          <ul class="upcoming">
            {#each upcoming as item (item.match.key)}
              {@const partners = (item.match.alliances?.[item.alliance]?.team_keys || []).filter(
                (key) => key !== row.teamKey
              )}
              {@const opponents = item.match.alliances?.[item.alliance === 'red' ? 'blue' : 'red']?.team_keys || []}
              {@const win =
                item.projection?.redWinProbability == null
                  ? null
                  : item.alliance === 'red'
                    ? item.projection.redWinProbability
                    : 1 - item.projection.redWinProbability}
              <li class={item.alliance}>
                <div class="up-top">
                  <b>{shortMatchLabel(item.match.key)}</b>
                  <span class="win" class:fav={win != null && win >= 0.5}
                    >{win == null ? '—' : `${pct(win)} to win`}</span
                  >
                </div>
                <div class="up-teams">
                  <span
                    ><small>With</small>{#each partners as key}{#if onSelectTeam}<button
                          type="button"
                          class="team-link"
                          on:click={() => onSelectTeam(key)}>{team(key)}</button
                        >{:else}<span class="team-link">{team(key)}</span>{/if}{/each}</span
                  >
                  <span
                    ><small>Against</small>{#each opponents as key}{#if onSelectTeam}<button
                          type="button"
                          class="team-link"
                          on:click={() => onSelectTeam(key)}>{team(key)}</button
                        >{:else}<span class="team-link">{team(key)}</span>{/if}{/each}</span
                  >
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="card" aria-labelledby="play-title">
        <div class="card-head"><h3 id="play-title">How they play</h3></div>
        {#if roleEntries.length}
          <ul class="roles">
            {#each roleEntries as [role, count] (role)}
              <li>
                <span>{role}</span><span class="role-bar"
                  ><span style={`width:${(count / roleTotal) * 100}%`}></span></span
                ><b>{count}</b>
              </li>
            {/each}
          </ul>
        {:else}<p class="muted">No teleop roles reported yet.</p>{/if}
        {#if row.autoPaths.length}
          <h4>Saved autos</h4>
          <ul class="plain">
            {#each row.autoPaths as path}<li>{path.name} <span class="muted">{path.alliance}</span></li>{/each}
          </ul>
        {/if}
      </section>
    </div>

    <div class="two">
      <section class="card" aria-labelledby="pit-title">
        <div class="card-head"><h3 id="pit-title">Pit capability</h3></div>
        {#if pitRows.length}
          <dl class="pit">
            {#each pitRows as [label, value] (label)}<div>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>{/each}
          </dl>
          {#if String(row.pitEntry?.additional_notes || '').trim()}<p class="notes-text">
              {row.pitEntry.additional_notes}
            </p>{/if}
        {:else}<p class="muted">No pit profile yet.</p>{/if}
      </section>

      <section class="card" aria-labelledby="issues-title">
        <div class="card-head">
          <h3 id="issues-title">Issues and notes</h3>
          {#if stats.openIssues}<span class="flag"><AlertTriangle size={14} /> {stats.openIssues} open</span>{/if}
        </div>
        {#if row.openProblems.length}
          <ul class="plain risk">
            {#each row.openProblems as issue}<li><b>{issue.severity || 'watch'}</b> {issue.summary}</li>{/each}
          </ul>
        {/if}
        {#if row.notes.length}
          <ul class="plain">
            {#each row.notes as note}<li>{note.notes || note.note || 'Untitled note'}</li>{/each}
          </ul>
        {/if}
        {#if !row.openProblems.length && !row.notes.length}<p class="muted">No open issues or scout notes.</p>{/if}
      </section>
    </div>

    <section class="card" aria-labelledby="reports-title">
      <div class="card-head">
        <h3 id="reports-title">Scouting reports</h3>
        <div class="kind-tabs" role="tablist" aria-label="Report kind">
          {#each ['data', 'performance', 'robot'] as kind (kind)}
            <button
              type="button"
              role="tab"
              aria-selected={kindTab === kind}
              class:on={kindTab === kind}
              on:click={() => {
                kindTab = kind;
                showAllReports = false;
              }}>{KIND_TABS[kind]} <span class="count">{reportsByKind[kind].length}</span></button
            >
          {/each}
        </div>
      </div>
      {#if !reportsByKind[kindTab].length}
        <p class="muted">No {KIND_TABS[kindTab]} reports for this team yet.</p>
      {:else}
        <div class="reports">
          {#each shownReports as entry (entry.id)}<MatchScoutReport report={entry} />{/each}
        </div>
        {#if reportsByKind[kindTab].length > REPORTS_SHOWN}
          <button type="button" class="text-btn" on:click={() => (showAllReports = !showAllReports)}
            >{showAllReports ? 'Show the latest only' : `Show all ${reportsByKind[kindTab].length}`}</button
          >
        {/if}
      {/if}
    </section>
  </div>
{/if}

<style>
  .brief {
    container-type: inline-size;
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  /* The grid gap is the only spacing between sections (no stray card margins), so every gap is the same. */
  .brief > :global(*),
  .two > :global(*) {
    margin: 0;
  }
  .hero {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .hero-id {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
  }
  .number {
    font-family: var(--font-display);
    font-size: 2.6rem;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1;
    color: var(--text-strong, var(--text));
    font-variant-numeric: tabular-nums;
  }
  .hero h2 {
    margin: 0;
    font-size: 1.3rem;
    overflow-wrap: anywhere;
  }
  .hero p {
    margin: 2px 0 0;
    color: var(--text-secondary);
  }
  .hero-chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  /* Same-size stat boxes: label on top, a large value under it. */
  .chip {
    display: grid;
    align-content: center;
    gap: 2px;
    min-width: 6.5rem;
    min-height: 3.25rem;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .chip small {
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.75rem);
    white-space: nowrap;
  }
  .chip b {
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .hero-chips .btn {
    align-self: stretch;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* Eight boxes in a 4 x 2 grid that always fills the width (2 x 4 when the brief is narrow). */
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .metric {
    display: grid;
    align-content: start;
    gap: var(--space-1);
    min-width: 0;
    min-height: 7.5rem;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .metric .k {
    color: var(--text-muted);
    font-size: 0.72rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .metric strong {
    font-weight: 500;
    letter-spacing: -0.02em;
    font-size: 2.1rem;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .metric small {
    color: var(--text-secondary);
    font-size: max(var(--text-min), 0.78rem);
    overflow-wrap: anywhere;
  }
  .metric.warn strong {
    color: var(--danger);
  }

  .card {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    min-width: 0;
    padding: var(--space-4) var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    flex-wrap: wrap;
  }
  .card h3 {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .card h4 {
    margin: var(--space-2) 0 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
  .two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4);
  }
  @container (max-width: 44rem) {
    .metrics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .two {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: var(--space-2);
    margin: 0;
  }
  .facts > div {
    display: grid;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
  }
  .facts dt {
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.75rem);
  }
  .facts dd {
    display: grid;
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .facts dd small {
    color: var(--text-secondary);
    font-size: max(var(--text-min), 0.72rem);
    font-weight: 400;
  }
  .facts > .bad dd {
    color: var(--danger);
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
  }

  .legend {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.75rem);
  }
  .dot {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
  }
  .dot.ok,
  .bar {
    background: var(--accent);
  }
  .dot.incident,
  .bar.incident {
    background: var(--warning);
  }
  .dot.noshow,
  .bar.noshow {
    background: var(--danger);
  }
  /* One fixed-width column per match, scrolling sideways when there are many, so labels never overlap. */
  .timeline {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(2.4rem, 1fr);
    gap: var(--space-1);
    overflow-x: auto;
    padding-bottom: var(--space-1);
  }
  .col {
    display: grid;
    grid-template-rows: auto 7rem auto auto;
    justify-items: center;
    gap: 2px;
    min-width: 0;
  }
  .val {
    font-size: max(var(--text-min), 0.72rem);
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }
  .track {
    display: flex;
    align-items: flex-end;
    width: 70%;
    height: 100%;
    background: var(--surface-2);
  }
  .bar {
    display: block;
    width: 100%;
  }
  .bar.empty {
    background: var(--border);
  }
  .lab {
    font-size: max(var(--text-min), 0.72rem);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .res {
    min-width: 1.4rem;
    padding: 0 4px;
    text-align: center;
    font-size: max(var(--text-min), 0.7rem);
    font-weight: 700;
    color: var(--text-muted);
  }
  .res.win {
    color: var(--success);
  }
  .res.loss {
    color: var(--danger);
  }

  .upcoming {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .upcoming li {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .upcoming li.red {
    box-shadow: inset 3px 0 0 var(--alliance-red-text);
  }
  .upcoming li.blue {
    box-shadow: inset 3px 0 0 var(--alliance-blue-text);
  }
  .up-top {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .win {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .outcome {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .outcome.win {
    color: var(--success);
  }
  .outcome.loss {
    color: var(--danger);
  }
  .win.fav {
    color: var(--success);
    font-weight: 700;
  }
  .up-teams {
    display: grid;
    gap: 2px;
  }
  .up-teams > span {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-wrap: wrap;
  }
  .up-teams small {
    min-width: 3.6rem;
    color: var(--text-muted);
    font-size: var(--text-min);
  }
  .team-link {
    min-height: 1.75rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  button.team-link:hover {
    border-color: var(--accent);
  }

  .roles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .roles li {
    display: grid;
    grid-template-columns: minmax(5rem, 7rem) minmax(0, 1fr) 2rem;
    align-items: center;
    gap: var(--space-2);
  }
  .role-bar {
    height: 0.55rem;
    background: var(--surface-2);
  }
  .role-bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .roles b {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .pit {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: var(--space-2) var(--space-3);
    margin: 0;
  }
  .pit dt {
    color: var(--text-muted);
    font-size: max(var(--text-min), 0.75rem);
  }
  .pit dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .notes-text {
    margin: 0;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .plain {
    margin: 0;
    padding-left: 1.1rem;
    display: grid;
    gap: var(--space-1);
    overflow-wrap: anywhere;
  }
  .risk b {
    text-transform: uppercase;
    font-size: 0.75rem;
    color: var(--danger);
  }
  .flag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--danger);
    font-size: 0.85rem;
  }

  .kind-tabs {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid var(--border);
  }
  .kind-tabs button {
    min-height: 2.25rem;
    padding: 0 var(--space-3);
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .kind-tabs button.on {
    background: var(--surface-2);
    color: var(--text);
  }
  .count {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .reports {
    display: grid;
    gap: var(--space-2);
  }
  .text-btn {
    justify-self: start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    cursor: pointer;
  }
  @media (max-width: 900px) {
    .kind-tabs button,
    .team-link {
      min-height: var(--tap-min);
    }
    .number {
      font-size: 2rem;
    }
  }
</style>

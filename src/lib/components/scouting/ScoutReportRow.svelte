<script>
  import MatchScoutReport from './MatchScoutReport.svelte';
  import { matchNumber, teamNumber, autoPoints, reportFlags, reportTime, scoutOf } from '$lib/scouting/scoutData.js';

  export let report;
  export let onRemove = null;
  // Why this report was pulled out (a disagreement between scouts, for example).
  export let reason = '';
  // Rows listed under a team or a match leave out the part that heading already says.
  export let showTeam = true;
  export let showMatch = true;
  // Roomy layout for a card: every figure gets a caption and nothing is cut off.
  export let labeled = false;

  const BAD_STATUS = ['dead', 'stopped', 'brownout', 'disabled'];
  let open = false;

  const shown = (value) => (value === null || value === undefined || value === '' ? '–' : value);
  const when = (stamp) => {
    const date = stamp ? new Date(stamp) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '–';
  };

  $: match = matchNumber(report);
  $: flags = reportFlags(report);
  $: balls = report.balls_scored_band || report.balls_scored_average;
  $: status = report.form_version === 2 ? report.teleop_robot_status : report.robot_disabled;
</script>

<div class="rr" class:open>
  <button
    class="main"
    class:labeled
    style="--lead: {(showMatch ? 5.5 : 0) + (showTeam ? 5.5 : 0)}rem"
    type="button"
    aria-expanded={open}
    on:click={() => (open = !open)}
  >
    <span class="cell lead-cell">
      {#if showMatch}<span class="id">{match === null ? '–' : `Match ${match}`}</span>{/if}
      {#if showTeam}<span class="id">Team {teamNumber(report.team_key)}</span>{/if}
    </span>
    <span class="cell"><small>Auto</small>{shown(autoPoints(report))}</span>
    <span class="cell"><small>Balls</small>{shown(balls)}</span>
    <span class="cell" class:warn={BAD_STATUS.includes(String(status).toLowerCase())}
      ><small>Status</small>{shown(status)}</span
    >
    <span class="cell flags" class:bad={flags.length}>{flags.length ? flags.join(' · ') : ''}</span>
    <span class="cell reason" title={reason}>{reason}</span>
    <span class="cell who"><span>{scoutOf(report)}</span><time>{when(reportTime(report))}</time></span>
  </button>
  {#if onRemove}
    <button
      class="remove"
      type="button"
      title="Remove this report"
      aria-label={`Remove the Q${match ?? ''} report for team ${teamNumber(report.team_key)}`}
      on:click={() => onRemove(report)}>&times;</button
    >
  {/if}
  {#if open}<div class="detail"><MatchScoutReport {report} bodyOnly /></div>{/if}
</div>

<style>
  .rr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }
  .rr:last-child {
    border-bottom: 0;
  }
  .rr.open {
    background: var(--surface-2);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: var(--lead) 4rem 5rem 5.5rem minmax(6rem, 10rem) minmax(8rem, 1fr) minmax(10rem, 13rem);
    gap: var(--space-3);
    align-items: center;
    min-height: 3rem;
    padding: 0 var(--space-3) 0 var(--space-4);
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .main:hover {
    background: var(--surface-2);
  }
  .main:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .cell {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .cell small {
    display: none;
  }
  .main.labeled {
    grid-template-columns: repeat(3, max-content) minmax(8rem, 1fr);
    column-gap: var(--space-5);
    row-gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
  }
  .main.labeled .lead-cell {
    display: none;
  }
  .main.labeled .cell small {
    display: block;
    margin-bottom: 1px;
    color: var(--text-muted);
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .main.labeled .cell {
    font-size: 0.9rem;
    overflow: visible;
    text-overflow: clip;
  }
  .main.labeled .flags {
    grid-column: 1 / -1;
    overflow: visible;
    white-space: normal;
    text-overflow: clip;
  }
  .main.labeled .flags:empty {
    display: none;
  }
  .main.labeled .reason {
    grid-column: 1 / -1;
    overflow: visible;
    white-space: normal;
  }
  .main.labeled .reason:empty {
    display: none;
  }
  .main.labeled .who {
    grid-column: 4;
    grid-row: 1;
    align-items: flex-end;
    text-align: right;
  }
  .lead-cell {
    display: flex;
    gap: var(--space-3);
  }
  .id {
    flex: 0 0 auto;
    min-width: 5.5rem;
    font-weight: 600;
    color: var(--text-secondary);
  }
  .warn {
    color: var(--warning);
  }
  .bad {
    color: var(--danger);
  }
  .flags {
    font-size: 0.8rem;
  }
  .who {
    display: flex;
    flex-direction: column;
    text-align: right;
    line-height: 1.25;
  }
  .who span {
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.8rem;
  }
  .who time {
    color: var(--text-muted);
    font-size: 0.72rem;
  }
  .remove {
    flex: 0 0 2.4rem;
    height: 2.4rem;
    margin-right: var(--space-2);
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.15rem;
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .remove:hover {
    color: var(--danger);
    background: var(--surface-3);
  }
  .reason {
    color: var(--warning);
    font-size: 0.8rem;
  }
  .detail {
    flex: 0 0 100%;
    border-top: 1px solid var(--border);
  }
  @media (max-width: 760px) {
    .main {
      grid-template-columns: 1fr 1fr;
      row-gap: var(--space-1);
      padding: var(--space-2) var(--space-3);
    }
    .cell small {
      display: inline;
      margin-right: 0.3rem;
      color: var(--text-muted);
      font-size: 0.7rem;
    }
    .lead-cell {
      grid-column: 1 / -1;
    }
    .flags,
    .who {
      grid-column: 1 / -1;
      text-align: left;
      align-items: flex-start;
    }
    .who {
      flex-direction: row;
      gap: var(--space-2);
    }
    .reason:empty {
      display: none;
    }
    .reason {
      grid-column: 1 / -1;
      white-space: normal;
    }
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .cell,
    .who span {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

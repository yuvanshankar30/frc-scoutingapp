<script>
  import { createEventDispatcher } from 'svelte';
  import { X } from 'lucide-svelte';
  import { projectMatch, isMatchPlayed } from '$lib/matches/matchProjection.js';
  import { tbaMatchLabel } from '$lib/matches/matchKeys.js';
  import { matchVideoUrl } from '$lib/matches/tbaMedia.js';

  export let match = null;
  export let eventKey = '';
  export let scoutPowerByTeam = new Map();
  export let projectedScoreByTeam = new Map();
  // The event's EPA model ({ byTeam, scale }), when the page has one.
  export let epaModel = null;
  export let breakdownByTeam = new Map();

  const dispatch = createEventDispatcher();
  const teamNumber = (teamKey) => String(teamKey || '').replace(/^frc/i, '');
  const teamHref = (teamKey) =>
    `/teamview?event_key=${encodeURIComponent(eventKey)}&team=${encodeURIComponent(teamKey)}&from=${encodeURIComponent('/strategy')}&fromLabel=${encodeURIComponent('Strategy')}`;

  // Tracks which match this fetch was for, so a stale response from a
  // previous match (opened, closed, another opened before the first
  // request resolved) can never overwrite the currently-open match's video.

  $: projection = match
    ? projectMatch(match, scoutPowerByTeam, projectedScoreByTeam, epaModel)
    : { redWinProbability: null };
  $: played = match ? isMatchPlayed(match) : false;
  $: fallbackVideoUrl = match ? matchVideoUrl(match) : '';
  $: fallbackVideoLabel = match?.videos?.some((video) => video?.type === 'youtube') ? 'YouTube' : 'TBA';

  function close() {
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') close();
  }
</script>

{#if match}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    on:click|self={close}
    on:keydown={(e) => {
      if (e.key === 'Escape') close();
      handleKeydown(e);
    }}
  >
    <div
      class="modal match-detail-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-label={`Match detail for ${tbaMatchLabel(match)}`}
    >
      <div class="modal-header">
        <h3>{tbaMatchLabel(match)}</h3>
        <button type="button" class="modal-close-button" aria-label="Close" on:click={close}><X size={18} /></button>
      </div>
      <div class="modal-body">
        <div class="match-detail-alliances">
          <div class="alliance-column alliance-red" class:winner={match.winning_alliance === 'red'}>
            <div class="alliance-heading">
              <span>Red</span>
              {#if played}<span class="alliance-score">{match.alliances?.red?.score ?? ''}</span>{/if}
            </div>
            {#each match.alliances?.red?.team_keys || [] as teamKey}
              <a class="team-link" href={teamHref(teamKey)}>
                {teamNumber(teamKey)}
                {#if breakdownByTeam.get(teamKey)}<span class="breakdown-dot" aria-hidden="true"></span><small
                    class="breakdown-text">{breakdownByTeam.get(teamKey)}</small
                  >{/if}
              </a>
            {/each}
          </div>
          <div class="alliance-column alliance-blue" class:winner={match.winning_alliance === 'blue'}>
            <div class="alliance-heading">
              <span>Blue</span>
              {#if played}<span class="alliance-score">{match.alliances?.blue?.score ?? ''}</span>{/if}
            </div>
            {#each match.alliances?.blue?.team_keys || [] as teamKey}
              <a class="team-link" href={teamHref(teamKey)}>
                {teamNumber(teamKey)}
                {#if breakdownByTeam.get(teamKey)}<span class="breakdown-dot" aria-hidden="true"></span><small
                    class="breakdown-text">{breakdownByTeam.get(teamKey)}</small
                  >{/if}
              </a>
            {/each}
          </div>
        </div>

        {#if projection.redProjectedScore != null || projection.blueProjectedScore != null}
          <div class="match-detail-predicted muted">
            Predicted score: {Number.isFinite(projection.redProjectedScore)
              ? projection.redProjectedScore.toFixed(0)
              : '-'} - {Number.isFinite(projection.blueProjectedScore) ? projection.blueProjectedScore.toFixed(0) : '-'}
          </div>
        {/if}

        <div class="match-detail-status muted">
          {#if played}
            {match.winning_alliance ? `${match.winning_alliance} won` : 'Tie'}
          {:else if projection.redWinProbability != null}
            Red projected {Math.round(projection.redWinProbability * 100)}% / Blue projected {Math.round(
              (1 - projection.redWinProbability) * 100
            )}%
          {:else}
            Not enough scouting yet for a projection
          {/if}
        </div>

        <div class="match-detail-video">
          <h4>Video</h4>
          {#if fallbackVideoUrl}
            <a class="btn btn-outline btn-sm" href={fallbackVideoUrl} target="_blank" rel="noreferrer"
              >Watch on {fallbackVideoLabel}</a
            >
          {:else}
            <div class="empty">No video for this match yet.</div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .match-detail-modal {
    --modal-width: 640px;
  }
  .match-detail-alliances {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap-3);
  }
  .alliance-column {
    display: grid;
    gap: var(--gap-1);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    align-content: start;
  }
  .alliance-red {
    background: color-mix(in srgb, var(--chart-danger) 8%, transparent);
  }
  .alliance-blue {
    background: color-mix(in srgb, var(--chart-blue) 8%, transparent);
  }
  .alliance-column.winner {
    border-color: var(--chart-success);
  }
  .alliance-heading {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    margin-bottom: var(--space-1);
  }
  .alliance-score {
    color: var(--text-muted);
  }
  .team-link {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-xs);
    font-weight: 600;
    text-decoration: none;
    color: var(--text);
    background: var(--surface-1);
  }
  .team-link:hover {
    text-decoration: underline;
  }
  .breakdown-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--chart-danger);
    margin-left: 3px;
    vertical-align: middle;
  }
  .breakdown-text {
    display: block;
    color: var(--danger);
    font-size: max(var(--font-xs), var(--text-min));
    font-weight: 500;
    white-space: normal;
  }
  .match-detail-predicted {
    margin-top: var(--space-2);
  }
  .match-detail-status {
    margin-top: var(--space-3);
  }
  .match-detail-video {
    margin-top: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }
  .match-detail-video h4 {
    margin: 0;
  }

  @media (max-width: 640px) {
    .match-detail-alliances {
      grid-template-columns: 1fr;
    }
  }
</style>

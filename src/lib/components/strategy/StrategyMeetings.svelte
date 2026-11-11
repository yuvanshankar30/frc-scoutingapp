<script>
  // Strategy > Matches: for each of our next matches, when to set up the alliance strategy meeting, when to hold
  // it, when the pit crew needs the plan and when to tell the drive coach (see src/lib/scouting/meetingPlan.js). Partner
  // phone numbers come from pit scouting ("Strat person's phone number"). Phones get one stacked card per match.
  import { onMount } from 'svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { shortMatchLabel } from '$lib/matches/matchKeys.js';
  import { teamNumber } from '$lib/matches/matchView.js';
  import { formatLocalTime } from '$lib/app/timezone.js';
  import {
    DRIVE_COACH_MINUTES,
    DRIVE_COACH_NAME,
    MEETING_LEADS,
    QUEUE_AHEAD,
    buildMeetingPlan
  } from '$lib/scouting/meetingPlan.js';
  import { dialablePhone as dial } from '$lib/scouting/pitForm.js';
  import { timeFor } from '$lib/scouting/strategySchedule.js';

  export let matches = [];
  export let teamKey = '';
  /** @type {Map<string, string>} team key -> strat person's phone from pit scouting */
  export let phoneByTeam = new Map();
  /** @type {Map<string, string>} team key -> team name */
  export let nameByTeam = new Map();
  export let onSelectTeam = () => {};

  const SHOWN = 6;
  // Re-check which steps have gone by every minute, so the highlighted step moves on during the event.
  let now = Date.now() / 1000;
  onMount(() => {
    const timer = setInterval(() => (now = Date.now() / 1000), 60_000);
    return () => clearInterval(timer);
  });

  $: plans = buildMeetingPlan(matches, teamKey, { now, limit: SHOWN });

  const team = teamNumber;
  const at = (seconds) =>
    Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? formatLocalTime(new Date(Number(seconds) * 1000)) : '';
  const slot = (step, fallback) =>
    step.match ? `${shortMatchLabel(step.match.key)}${at(step.time) ? ` · ~${at(step.time)}` : ''}` : fallback;

  const STEPS = [
    {
      key: 'arrange',
      title: 'Set a meeting time',
      when: (plan) => slot(plan.steps.arrange, 'Now: we play early'),
      detail: () => `About ${MEETING_LEADS.arrange} matches out: find or text someone on each partner team.`
    },
    {
      key: 'meet',
      title: 'Strategy meeting',
      when: (plan) => slot(plan.steps.meet, 'As soon as you can'),
      detail: (plan) =>
        plan.steps.meet.busy.length
          ? `No gap where all three teams are free. Busy then (queueing ${QUEUE_AHEAD} matches ahead, playing or walking back): ${plan.steps.meet.busy.map(team).join(', ')}.`
          : 'All three teams are free: nobody is queueing, playing or walking back from the field.'
    },
    {
      key: 'pitCrew',
      title: 'Send our strategy to the pit crew',
      when: (plan) => (plan.steps.pitCrew.match ? `By ${slot(plan.steps.pitCrew)}` : 'As soon as you can'),
      detail: () => `About ${MEETING_LEADS.pitCrew} matches out, so they can check every robot can do its part.`
    },
    {
      key: 'driveCoach',
      title: `Tell ${DRIVE_COACH_NAME}`,
      when: (plan) =>
        at(plan.steps.driveCoach.time)
          ? `~${at(plan.steps.driveCoach.time)}${plan.steps.driveCoach.match ? ` · around ${shortMatchLabel(plan.steps.driveCoach.match.key)}` : ''}`
          : slot(plan.steps.driveCoach, 'Before the match'),
      detail: () => `${DRIVE_COACH_MINUTES} minutes (1-2 matches) before our match.`
    }
  ];
</script>

{#if !teamKey}
  <p class="empty">Set our team number to plan strategy meetings.</p>
{:else if !plans.length}
  <p class="empty">No upcoming matches for {team(teamKey)} in the schedule yet.</p>
{:else}
  <ol class="plans" class:phone={$isPhone} aria-label="Strategy meetings for our next matches">
    {#each plans as plan (plan.match.key)}
      <li class="plan {plan.alliance}">
        <header>
          <b>{shortMatchLabel(plan.match.key)}</b>
          <span class="when">{at(timeFor(plan.match)) || 'Time TBA'}</span>
          <span class="alliance">{plan.alliance}</span>
        </header>
        <ul class="partners" aria-label="Partners">
          {#each plan.partners as key (key)}
            {@const phone = phoneByTeam.get(key)}
            <li>
              <button type="button" class="team-chip" on:click={() => onSelectTeam(key)}
                >{team(key)}{#if nameByTeam.get(key)}<small>{nameByTeam.get(key)}</small>{/if}</button
              >
              {#if phone && dial(phone)}
                <span class="contact"
                  ><a href={`sms:${dial(phone)}`}>Text</a><a href={`tel:${dial(phone)}`}>{phone}</a></span
                >
              {:else}<span class="contact missing">No strat phone in pit scouting</span>{/if}
            </li>
          {/each}
        </ul>
        <ol class="steps">
          {#each STEPS as step (step.key)}
            <li
              class:done={plan.steps[step.key].done}
              class:next={plan.next === step.key}
              aria-current={plan.next === step.key ? 'step' : undefined}
            >
              <div class="step-head">
                <strong>{step.title}</strong>
                <span>{step.when(plan)}</span>
              </div>
              <p>{step.detail(plan)}</p>
            </li>
          {/each}
        </ol>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .empty {
    padding: var(--space-4);
    color: var(--text-muted);
  }
  .plans {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plans.phone {
    grid-template-columns: minmax(0, 1fr);
  }
  .plan {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-left: 4px solid var(--border);
    border-radius: var(--radius-md, 10px);
    background: var(--surface-1);
  }
  .plan.red {
    border-left-color: var(--red-base);
  }
  .plan.blue {
    border-left-color: var(--blue-base);
  }
  header {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  header b {
    font-size: 1.15rem;
  }
  .when {
    color: var(--text-secondary);
  }
  .alliance {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 0.8rem;
    text-transform: capitalize;
  }
  .partners {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .partners li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .team-chip {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    text-align: left;
    gap: var(--space-1);
    min-height: var(--tap-min, 44px);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-2, var(--surface-1));
    color: var(--text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .team-chip small {
    color: var(--text-muted);
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .contact {
    display: inline-flex;
    gap: var(--space-3);
  }
  .contact a {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap-min, 44px);
    color: var(--accent);
    font-weight: 600;
  }
  .contact.missing {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .steps {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .steps li {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
  }
  .steps li.done {
    opacity: 0.55;
  }
  .steps li.next {
    border-color: var(--accent);
    background: var(--accent-subtle, transparent);
    opacity: 1;
  }
  .step-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-1) var(--space-2);
  }
  .step-head span {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .steps p {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
</style>

<script>
  // Pit Scout > Problems: the shared repair queue (open and resolved reports) and the form to add one.
  // The page owns the data and the API calls; this is the layout, with phones adding from a bottom sheet.
  import BottomSheet from '$lib/components/common/BottomSheet.svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { matchLabel } from '$lib/matches/matchKeys.js';

  export let problems = [];
  export let teams = [];
  export let loading = false;
  export let saving = false;
  export let eventLabel = 'the active event';
  export let readOnly = false;
  export let onRefresh = () => {};
  export let onCreate = async () => false;
  export let onResolve = () => {};

  const emptyDraft = () => ({ team_key: '', summary: '', detail: '', severity: 'watch' });
  let draft = emptyDraft();
  let problemSheetOpen = false;

  const displayTeam = (teamKey) => (teamKey ? String(teamKey).replace(/^frc/i, '') : '');
  $: openProblems = problems.filter((problem) => !problem.resolved);
  $: resolvedProblems = problems.filter((problem) => problem.resolved);

  async function submit() {
    if (await onCreate(draft)) {
      draft = emptyDraft();
      problemSheetOpen = false;
    }
  }
</script>

<div class="problems-layout">
  <section class="card problem-queue">
    <div class="problem-heading">
      <div>
        <h3>Shared repair queue</h3>
        <p>Problems reported by match and pit scouts for {eventLabel}.</p>
      </div>
      <button class="btn btn-secondary" type="button" on:click={onRefresh} disabled={loading}>Refresh</button>
    </div>

    {#if loading}
      <div class="empty">Loading problems...</div>
    {:else if !problems.length}
      <div class="empty">No pit problems reported for this event.</div>
    {:else if !openProblems.length}
      <div class="empty">No open pit problems for this event.</div>
    {:else}
      <div class="problem-list">
        {#each openProblems as problem (problem.id)}
          <article class="problem-card" class:urgent={problem.severity === 'urgent'}>
            <div class="problem-meta">
              <strong>Team {displayTeam(problem.team_key)}</strong>
              <span class="severity">{problem.severity}</span>
              <span>{problem.source || 'Scout'}</span>
              {#if problem.match_key}<span>{matchLabel(problem.match_key)}</span>{/if}
            </div>
            <h4>{problem.summary}</h4>
            {#if problem.detail}<p>{problem.detail}</p>{/if}
            <button class="btn btn-primary" type="button" disabled={saving} on:click={() => onResolve(problem, true)}
              >Mark resolved</button
            >
          </article>
        {/each}
      </div>
    {/if}

    {#if resolvedProblems.length}
      <details class="resolved-problems">
        <summary>Resolved problems ({resolvedProblems.length})</summary>
        {#each resolvedProblems as problem (problem.id)}
          <div class="resolved-row">
            <span>Team {displayTeam(problem.team_key)} · {problem.summary}</span>
            <button class="btn btn-outline" type="button" disabled={saving} on:click={() => onResolve(problem, false)}
              >Reopen</button
            >
          </div>
        {/each}
      </details>
    {/if}
  </section>

  {#if $isPhone}
    <button type="button" class="btn btn-primary pp-dock" on:click={() => (problemSheetOpen = true)}
      >Add a pit report</button
    >
    <BottomSheet open={problemSheetOpen} title="Add a pit report" on:close={() => (problemSheetOpen = false)}>
      {@render problemForm()}
    </BottomSheet>
  {:else}
    {@render problemForm()}
  {/if}
</div>

{#snippet problemForm()}
  <form class="card problem-form" on:submit|preventDefault={submit}>
    <h3>Add a pit report</h3>
    {#if readOnly}<div class="note">Switch to the current event before adding a problem.</div>{/if}
    <div class="form-group">
      <label class="form-label" for="problemTeam">Team</label>
      <Select id="problemTeam" class="form-select" bind:value={draft.team_key} disabled={readOnly}>
        <option value="">-- Select --</option>
        {#each teams as teamKey}<option value={teamKey}>Team {displayTeam(teamKey)}</option>{/each}
      </Select>
    </div>
    <div class="form-group">
      <label class="form-label" for="problemSummary">Problem</label>
      <input
        id="problemSummary"
        class="form-input"
        maxlength="300"
        bind:value={draft.summary}
        placeholder="Example: intake belt slipping"
        disabled={readOnly}
      />
    </div>
    <div class="form-group">
      <label class="form-label" for="problemSeverity">Severity</label>
      <Select id="problemSeverity" class="form-select" bind:value={draft.severity} disabled={readOnly}>
        <option value="watch">Watch</option><option value="urgent">Urgent</option>
      </Select>
    </div>
    <div class="form-group">
      <label class="form-label" for="problemDetail">Details</label>
      <textarea
        id="problemDetail"
        class="form-input"
        rows="5"
        bind:value={draft.detail}
        placeholder="What failed and what should be checked?"
        disabled={readOnly}
      ></textarea>
    </div>
    <button
      class="btn btn-primary"
      type="submit"
      disabled={saving || readOnly || !draft.team_key || !draft.summary.trim()}
    >
      {saving ? 'Saving...' : 'Add problem'}
    </button>
  </form>
{/snippet}

<style>
  .problems-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.75fr);
    align-items: start;
    gap: 1rem;
    max-width: 1100px;
    margin: 0 auto;
  }

  .problem-heading,
  .problem-meta,
  .resolved-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .problem-heading h3,
  .problem-heading p,
  .problem-form h3,
  .problem-card h4,
  .problem-card p {
    margin-top: 0;
  }

  .problem-heading p,
  .problem-card p {
    color: var(--text-muted);
  }

  .problem-list {
    display: grid;
    gap: 0.75rem;
  }

  .problem-card {
    padding: 1rem;
    border: 1px solid var(--border);
    border-left: 3px solid var(--warning);
    border-radius: var(--radius-sm);
  }

  .problem-card.urgent {
    border-left-color: var(--accent);
  }
  .problem-meta {
    justify-content: flex-start;
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .severity {
    text-transform: uppercase;
    font-weight: 700;
  }
  .resolved-problems {
    margin-top: 1rem;
  }
  .resolved-row {
    padding: 0.65rem 0;
    border-bottom: 1px solid var(--border);
  }
  .problem-form {
    align-self: start;
  }

  @media (max-width: 768px) {
    .problems-layout {
      grid-template-columns: 1fr;
    }
  }
  .pp-dock {
    position: fixed;
    left: calc(var(--page-gutter) + var(--safe-left));
    right: calc(var(--page-gutter) + var(--safe-right));
    bottom: calc(var(--dock-height) + var(--space-2));
    z-index: 10;
    min-height: var(--tap-comfort);
    justify-content: center;
    box-shadow: var(--shadow-dock);
  }
</style>

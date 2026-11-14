<script>
  // Data Viewer overview: one section of the chosen form at a time (Pre-match, Auto, Teleop, … or the pit sections),
  // its fields as same-size cards that open each field's page. Moving between sections slides the cards in from the
  // side you moved toward. A search shows matching fields from every section at once.
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ChevronLeft, ChevronRight } from 'lucide-svelte';
  import { isPhone } from '$lib/stores/device.js';
  import Select from '$lib/components/common/Select.svelte';
  import FieldCard from '$lib/components/dataViewer/FieldCard.svelte';
  import { useDataViewer } from '$lib/components/dataViewer/state.js';
  import { formSections } from '$lib/scouting/dataViewerFields.js';
  import { filterFields, filterRecords, groupBySection } from '$lib/scouting/dataViewer.js';

  const { form, sections, filters, search, hideEmpty, records, fields } = useDataViewer();

  // +1 when moving to a later section, -1 to an earlier one: the cards slide in from that side.
  let direction = 1;

  $: formRecords = $records[$form];
  $: shownRecords = filterRecords(formRecords, $form, $filters);
  $: query = $search.trim().toLowerCase();
  $: shownFields = filterFields($fields[$form], { ...$filters, section: '' }).filter(
    (field) => !query || `${field.label} ${field.sectionLabel}`.toLowerCase().includes(query)
  );
  $: groups = groupBySection(shownFields, shownRecords)
    // A built-in question hidden on the published form only shows while old reports still have answers to it.
    .map((group) => ({
      ...group,
      fields: group.fields.filter((entry) => entry.count || (!$hideEmpty && !entry.field.hiddenOnForm))
    }))
    .filter((group) => group.fields.length);
  // Every section of the form, with how many of its fields have answers under the filters.
  $: steps = formSections($form)
    .map((section) => {
      const group = groups.find((entry) => entry.id === section.id);
      return group
        ? { ...section, answered: group.fields.filter((entry) => entry.count).length, total: group.fields.length }
        : null;
    })
    .filter(Boolean);
  $: current = steps.find((step) => step.id === $sections[$form]) ? $sections[$form] : steps[0]?.id;
  $: index = steps.findIndex((step) => step.id === current);
  $: shownGroups = query ? groups : groups.filter((group) => group.id === current);
  $: shownTeams = new Set(shownRecords.map((record) => record.team_key)).size;
  $: answered = groups.reduce((total, group) => total + group.fields.filter((entry) => entry.count).length, 0);
  $: fieldTotal = groups.reduce((total, group) => total + group.fields.length, 0);

  function goTo(id) {
    const next = steps.findIndex((step) => step.id === id);
    if (next === -1 || id === current) return;
    direction = next > index ? 1 : -1;
    sections.update((value) => ({ ...value, [$form]: id }));
  }
  const step = (by) => steps[index + by] && goTo(steps[index + by].id);

  const fieldHref = (summary) => `/dataviewer/field/${summary.field.form}/${encodeURIComponent(summary.field.id)}`;
</script>

<svelte:head><title>Data Viewer</title></svelte:head>

<div class="overview" class:phone={$isPhone}>
  <div class="stat-strip">
    <span><b>{shownRecords.length}</b>{shownRecords.length === 1 ? 'report' : 'reports'}</span>
    <span><b>{shownTeams}</b>{shownTeams === 1 ? 'team' : 'teams'}</span>
    <span><b>{answered}<small>/{fieldTotal}</small></b>fields answered</span>
  </div>

  {#if !groups.length}
    <div class="empty-state">
      {formRecords.length ? 'No field matches these filters.' : 'Nothing has been scouted at this event yet.'}
    </div>
  {:else}
    {#if !query}
      {#if $isPhone}
        <div class="stepper">
          <button
            type="button"
            class="arrow"
            on:click={() => step(-1)}
            disabled={index <= 0}
            aria-label="Previous section"><ChevronLeft size={20} /></button
          >
          <Select
            value={current}
            on:change={(event) => goTo(event.target.value)}
            class="form-select"
            aria-label="Section"
          >
            {#each steps as entry (entry.id)}
              <option value={entry.id}>{entry.label} · {entry.answered}/{entry.total}</option>
            {/each}
          </Select>
          <button
            type="button"
            class="arrow"
            on:click={() => step(1)}
            disabled={index >= steps.length - 1}
            aria-label="Next section"><ChevronRight size={20} /></button
          >
        </div>
        <div class="dots" aria-hidden="true">
          {#each steps as entry, i (entry.id)}<span class:on={i === index}></span>{/each}
        </div>
      {:else}
        <nav class="steps" aria-label="Sections">
          {#each steps as entry, i (entry.id)}
            <button
              type="button"
              class:on={entry.id === current}
              aria-current={entry.id === current ? 'step' : undefined}
              on:click={() => goTo(entry.id)}
            >
              <span class="num">{i + 1}</span>
              {entry.label}
              <span class="count">{entry.answered}/{entry.total}</span>
            </button>
          {/each}
        </nav>
      {/if}
    {/if}

    <div class="stage">
      {#key `${$form}:${query ? 'search' : current}`}
        <div
          class="groups"
          in:fly={{ x: query ? 0 : direction * 32, y: query ? 8 : 0, duration: 240, easing: cubicOut }}
        >
          {#each shownGroups as group (group.id)}
            <section class="group" aria-label={group.label}>
              {#if query}<h2>{group.label}</h2>{/if}
              <div class="cards">
                {#each group.fields as summary (summary.field.id)}
                  <FieldCard {summary} href={fieldHref(summary)} />
                {/each}
              </div>
            </section>
          {/each}
          {#if !query && !$isPhone && steps.length > 1}
            <div class="pager">
              {#if index > 0}
                <button type="button" class="btn btn-outline" on:click={() => step(-1)}
                  ><ChevronLeft size={16} /> {steps[index - 1].label}</button
                >
              {:else}<span></span>{/if}
              {#if index < steps.length - 1}
                <button type="button" class="btn btn-outline" on:click={() => step(1)}
                  >{steps[index + 1].label} <ChevronRight size={16} /></button
                >
              {/if}
            </div>
          {/if}
        </div>
      {/key}
    </div>
  {/if}
</div>

<style>
  .overview {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }
  .stat-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }
  .stat-strip span {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    border-left: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stat-strip span:first-child {
    border-left: 0;
  }
  .stat-strip b {
    order: -1;
    color: var(--text-strong, var(--text));
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: -0.02em;
    text-transform: none;
    font-variant-numeric: tabular-nums;
  }
  .stat-strip small {
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  /* Desktop: the sections as numbered steps, the current one highlighted. */
  .steps {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .steps button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.5rem;
    padding: 0 var(--space-3) 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-1);
    color: var(--text-secondary);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      color 0.18s ease;
  }
  .steps button:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    color: var(--text-strong, var(--text));
  }
  .steps button.on {
    border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-1));
    color: var(--text-strong, var(--text));
  }
  .num {
    display: inline-grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    transition: background-color 0.18s ease;
  }
  .on .num {
    background: var(--accent);
    color: var(--on-accent, #111);
  }
  .count {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  /* The cards slide in inside a clipped stage, so the slide never pushes the page sideways. */
  .stage {
    overflow: hidden;
    min-width: 0;
    margin: -4px;
    padding: 4px;
  }
  .groups {
    display: grid;
    gap: var(--space-5, 1.5rem);
    min-width: 0;
  }
  .group {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .group h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-strong, var(--text));
  }
  /* Same-size cards: equal columns and every row as tall as its tallest card. */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
    grid-auto-rows: 1fr;
    gap: var(--space-3);
  }
  .pager {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  /* Phones: one column, a stepper with arrows and a section picker, and dots for where you are. */
  .stepper {
    display: grid;
    grid-template-columns: var(--tap-min) minmax(0, 1fr) var(--tap-min);
    align-items: center;
    gap: var(--space-2);
  }
  .stepper :global(.form-group) {
    margin: 0;
  }
  .arrow {
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-1);
    color: var(--text);
    cursor: pointer;
  }
  .arrow:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dots {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin-top: calc(-1 * var(--space-2));
  }
  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--border);
    transition:
      width 0.2s ease,
      background-color 0.2s ease;
  }
  .dots span.on {
    width: 18px;
    background: var(--accent);
  }
  .phone .cards {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: auto;
  }
  .phone .stat-strip span {
    padding: var(--space-2) var(--space-3);
    letter-spacing: 0.04em;
  }
  .phone .stat-strip b {
    font-size: 1.25rem;
  }
  @media (prefers-reduced-motion: reduce) {
    .steps button,
    .num,
    .dots span {
      transition: none;
    }
  }
</style>

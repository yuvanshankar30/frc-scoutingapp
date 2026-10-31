<script>
  import { createEventDispatcher } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import {
    AlignLeft,
    ChevronDown,
    ChevronUp,
    ChevronsUpDown,
    CircleDot,
    Copy,
    GripVertical,
    Hash,
    MousePointerClick,
    Plus,
    Star,
    SquareCheck,
    ToggleLeft,
    Trash2,
    TriangleAlert,
    Type,
    X
  } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { LIMITS, QUESTION_TYPES } from '$lib/scouting/forms/formSchema.js';

  export let question;
  export let index = 0;
  export let count = 1;
  export let expanded = false;
  export let problems = [];
  export let readonly = false;
  // 'added' or 'edited' while comparing against the live form.
  export let change = null;
  export let motion = true;
  export let sections = [];

  const dispatch = createEventDispatcher();
  const ICONS = {
    MousePointerClick,
    CircleDot,
    SquareCheck,
    ChevronsUpDown,
    ToggleLeft,
    Star,
    Plus,
    Hash,
    Type,
    AlignLeft
  };
  const dur = (ms) => (motion ? ms : 0);
  const meta = () => QUESTION_TYPES[question.type];
  const patch = (changes, group = null) => dispatch('patch', { changes, group });
  const setOption = (optionId, label) =>
    patch(
      { options: question.options.map((option) => (option.id === optionId ? { ...option, label } : option)) },
      `option:${optionId}`
    );
  const addOption = () =>
    patch({
      options: [
        ...question.options,
        { id: `o_${Math.random().toString(36).slice(2, 10)}`, label: `Option ${question.options.length + 1}` }
      ]
    });
  const removeOption = (optionId) => patch({ options: question.options.filter((option) => option.id !== optionId) });
  const moveOption = (position, direction) => {
    const next = [...question.options];
    const target = position + direction;
    if (target < 0 || target >= next.length) return;
    [next[position], next[target]] = [next[target], next[position]];
    patch({ options: next });
  };
  const numberOrNull = (value) => (value === '' ? null : Number(value));
</script>

<article class="qc" class:open={expanded} class:readonly class:has-problem={problems.length > 0} data-change={change}>
  <div class="qc-bar">
    {#if !readonly}<span class="qc-grip" title="Drag to reorder" aria-hidden="true"><GripVertical size={16} /></span
      >{/if}
    <button type="button" class="qc-head" aria-expanded={expanded} on:click={() => dispatch('toggle')}>
      <span class="qc-icon"><svelte:component this={ICONS[meta().icon]} size={16} /></span>
      <span class="qc-title" class:untitled={!question.label.trim()}
        >{question.label.trim() || 'Untitled question'}</span
      >
      <span class="qc-tags">
        {#if change}<span class="qc-pill change-{change}" transition:fade={{ duration: dur(120) }}
            >{change === 'added' ? 'New' : 'Edited'}</span
          >{/if}
        {#if problems.length}<span class="qc-pill warn"><TriangleAlert size={12} /> Fix</span>{/if}
        <span class="qc-pill">{meta().label}</span>
        {#if question.required}<span class="qc-pill req">Required</span>{/if}
      </span>
      <span class="qc-chevron" class:flip={expanded}><ChevronDown size={16} /></span>
    </button>
    {#if !readonly}
      <div class="qc-move">
        <button
          type="button"
          class="icon"
          aria-label="Move up"
          disabled={index === 0}
          on:click={() => dispatch('move', -1)}><ChevronUp size={15} /></button
        >
        <button
          type="button"
          class="icon"
          aria-label="Move down"
          disabled={index === count - 1}
          on:click={() => dispatch('move', 1)}><ChevronDown size={15} /></button
        >
      </div>
    {/if}
  </div>

  {#if expanded}
    <div class="qc-body" transition:slide={{ duration: dur(180) }}>
      {#if problems.length}
        <ul class="qc-problems" role="alert">
          {#each problems as problem}<li><TriangleAlert size={13} /> {problem}</li>{/each}
        </ul>
      {/if}
      <div class="qc-grid">
        <label class="qc-field wide">
          <span>Question</span>
          <!-- svelte-ignore a11y-autofocus -->
          <input
            class="form-input"
            type="text"
            maxlength={LIMITS.label}
            value={question.label}
            disabled={readonly}
            placeholder="What should the scout answer?"
            autofocus={!question.label && !readonly}
            on:input={(event) => patch({ label: event.target.value }, `label:${question.id}`)}
          />
        </label>
        <div class="qc-field">
          <span>Answer type</span>
          <Select
            class="form-input"
            value={question.type}
            disabled={readonly}
            on:change={(event) => dispatch('convert', event.target.value)}
            aria-label="Answer type"
          >
            {#each Object.entries(QUESTION_TYPES) as [type, info]}<option value={type}
                >{info.label} - {info.blurb}</option
              >{/each}
          </Select>
        </div>
        {#if sections.length > 1}
          <div class="qc-field">
            <span>Appears in</span>
            <Select
              class="form-input"
              value={question.section}
              disabled={readonly}
              on:change={(event) => dispatch('section', event.target.value)}
              aria-label="Section"
            >
              {#each sections as entry}<option value={entry.id}>{entry.label}</option>{/each}
            </Select>
          </div>
        {/if}
        <div class="qc-field">
          <span>Scouts must answer</span>
          <button
            type="button"
            class="qc-switch"
            role="switch"
            aria-checked={question.required}
            disabled={readonly}
            on:click={() => patch({ required: !question.required })}
          >
            <i aria-hidden="true"></i><b>{question.required ? 'Required' : 'Optional'}</b>
          </button>
        </div>
        <label class="qc-field wide">
          <span>Help text <em>optional</em></span>
          <input
            class="form-input"
            type="text"
            maxlength={LIMITS.help}
            value={question.help}
            disabled={readonly}
            placeholder="A hint shown under the question"
            on:input={(event) => patch({ help: event.target.value }, `help:${question.id}`)}
          />
        </label>

        {#if meta().options}
          <div class="qc-field wide">
            <span>Options <em>{question.options.length} of {LIMITS.options}</em></span>
            <ol class="qc-options">
              {#each question.options as option, position (option.id)}
                <li transition:slide={{ duration: dur(140) }}>
                  <b>{position + 1}</b>
                  <input
                    class="form-input"
                    type="text"
                    maxlength={LIMITS.optionLabel}
                    value={option.label}
                    disabled={readonly}
                    aria-label={`Option ${position + 1}`}
                    on:input={(event) => setOption(option.id, event.target.value)}
                  />
                  {#if !readonly}
                    <button
                      type="button"
                      class="icon"
                      aria-label="Move option up"
                      disabled={position === 0}
                      on:click={() => moveOption(position, -1)}><ChevronUp size={14} /></button
                    >
                    <button
                      type="button"
                      class="icon"
                      aria-label="Move option down"
                      disabled={position === question.options.length - 1}
                      on:click={() => moveOption(position, 1)}><ChevronDown size={14} /></button
                    >
                    <button
                      type="button"
                      class="icon danger"
                      aria-label="Remove option"
                      disabled={question.options.length <= 2}
                      on:click={() => removeOption(option.id)}><X size={14} /></button
                    >
                  {/if}
                </li>
              {/each}
            </ol>
            {#if !readonly}<button
                type="button"
                class="qc-add"
                disabled={question.options.length >= LIMITS.options}
                on:click={addOption}><Plus size={14} /> Add option</button
              >{/if}
          </div>
        {:else if question.type === 'rating'}
          <div class="qc-field">
            <span>Highest rating</span>
            <Select
              class="form-input"
              value={String(question.max)}
              disabled={readonly}
              on:change={(event) => patch({ max: Number(event.target.value) })}
              aria-label="Highest rating"
            >
              {#each [3, 4, 5, 6, 7, 8, 9, 10] as value}<option value={String(value)}>1 to {value}</option>{/each}
            </Select>
          </div>
        {:else if question.type === 'counter' || question.type === 'number'}
          <label class="qc-field"
            ><span>Minimum <em>optional</em></span><input
              class="form-input"
              type="number"
              value={question.min ?? ''}
              disabled={readonly}
              on:input={(event) => patch({ min: numberOrNull(event.target.value) }, `min:${question.id}`)}
            /></label
          >
          <label class="qc-field"
            ><span>Maximum <em>optional</em></span><input
              class="form-input"
              type="number"
              value={question.max ?? ''}
              disabled={readonly}
              on:input={(event) => patch({ max: numberOrNull(event.target.value) }, `max:${question.id}`)}
            /></label
          >
        {/if}
      </div>
      {#if !readonly}
        <footer class="qc-foot">
          <button type="button" class="btn btn-outline btn-sm" on:click={() => dispatch('duplicate')}
            ><Copy size={14} /> Duplicate</button
          >
          <button type="button" class="btn btn-outline-danger btn-sm" on:click={() => dispatch('remove')}
            ><Trash2 size={14} /> Delete question</button
          >
        </footer>
      {/if}
    </div>
  {/if}
</article>

<style>
  .qc {
    border: 1px solid var(--border);
    border-left-width: 3px;
    background: var(--surface-2);
    transition:
      border-color 0.16s ease,
      box-shadow 0.16s ease;
  }
  .qc:hover {
    border-color: color-mix(in srgb, var(--brand-gold-strong) 45%, var(--border));
  }
  .qc.open {
    border-color: var(--brand-gold-strong);
    box-shadow: var(--shadow-card);
  }
  .qc[data-change='added'] {
    border-left-color: var(--green-base, #3aa76d);
  }
  .qc[data-change='edited'] {
    border-left-color: var(--brand-gold-strong);
  }
  .qc.has-problem {
    border-left-color: var(--red-base);
  }
  .qc-bar {
    display: flex;
    align-items: stretch;
  }
  .qc-grip {
    display: grid;
    place-items: center;
    width: 1.9rem;
    color: var(--text-muted);
    cursor: grab;
  }
  .qc.readonly .qc-bar {
    padding-left: var(--space-2);
  }
  .qc-head {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0.7rem var(--space-3) 0.7rem 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .qc-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--brand-gold-strong);
  }
  .qc-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 0.92rem;
  }
  .qc-title.untitled {
    color: var(--text-muted);
    font-style: italic;
    font-weight: 400;
  }
  .qc-tags {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: none;
  }
  .qc-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.08rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-size: 0.66rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .qc-pill.req {
    border-color: var(--brand-gold-strong);
    color: var(--brand-gold-strong);
  }
  .qc-pill.warn {
    border-color: var(--red-base);
    color: var(--red-base);
  }
  .qc-pill.change-added {
    border-color: var(--green-base, #3aa76d);
    color: var(--green-base, #3aa76d);
  }
  .qc-pill.change-edited {
    border-color: var(--brand-gold-strong);
    color: var(--brand-gold-strong);
  }
  .qc-chevron {
    flex: none;
    display: grid;
    color: var(--text-muted);
    transition: transform 0.18s ease;
  }
  .qc-chevron.flip {
    transform: rotate(180deg);
  }
  .qc-move {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-right: var(--space-2);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.3rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .icon:hover:not(:disabled) {
    background: var(--surface-1);
    color: var(--text);
  }
  .icon:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .icon.danger:hover:not(:disabled) {
    color: var(--red-base);
  }
  .qc-body {
    padding: 0 var(--space-4) var(--space-4);
    border-top: 1px solid var(--border);
  }
  .qc-problems {
    display: grid;
    gap: 0.25rem;
    margin: var(--space-3) 0 0;
    padding: 0.55rem 0.75rem;
    list-style: none;
    border-left: 3px solid var(--red-base);
    background: var(--red-soft);
    color: var(--text);
    font-size: 0.82rem;
  }
  .qc-problems li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .qc-problems :global(svg) {
    color: var(--red-base);
    flex: none;
  }
  .qc-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-4);
    margin-top: var(--space-3);
  }
  .qc-field {
    display: grid;
    gap: 0.35rem;
    align-content: start;
    min-width: 0;
  }
  .qc-field.wide {
    grid-column: 1 / -1;
  }
  .qc-field > span {
    color: var(--text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .qc-field > span em {
    text-transform: none;
    letter-spacing: 0;
    font-style: normal;
    opacity: 0.75;
    margin-left: 0.35rem;
  }
  .qc-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 2.5rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .qc-switch i {
    position: relative;
    width: 2.1rem;
    height: 1.15rem;
    border-radius: 999px;
    background: var(--border);
    transition: background-color 0.16s ease;
  }
  .qc-switch i::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 50%;
    background: var(--text);
    transition: transform 0.16s ease;
  }
  .qc-switch[aria-checked='true'] i {
    background: var(--brand-gold-strong);
  }
  .qc-switch[aria-checked='true'] i::after {
    transform: translateX(0.95rem);
    background: var(--surface-1);
  }
  .qc-options {
    display: grid;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .qc-options li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .qc-options li b {
    flex: none;
    width: 1.4rem;
    color: var(--text-muted);
    font-size: 0.75rem;
    text-align: center;
    font-weight: 500;
  }
  .qc-options input {
    flex: 1;
    min-width: 0;
  }
  .qc-add {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: var(--space-1);
    padding: 0.35rem 0.7rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .qc-add:hover:not(:disabled) {
    border-color: var(--brand-gold-strong);
    color: var(--text);
  }
  .qc-add:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .qc-foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  @media (max-width: 640px) {
    .qc-grid {
      grid-template-columns: 1fr;
    }
    .qc-tags .qc-pill:not(.warn):not(.req) {
      display: none;
    }
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .qc-title {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

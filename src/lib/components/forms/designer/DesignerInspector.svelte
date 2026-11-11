<script>
  // The designer's right panel: everything about the selected card. A built-in block can be reworded, styled and (when
  // nothing depends on it) hidden; an added question can be changed in every way. Every change goes up as an event so
  // the designer keeps one undo history.
  import { createEventDispatcher } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ArrowDown, ArrowUp, Copy, ImagePlus, Plus, RotateCcw, Trash2, X } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import ColorPicker from '$lib/components/common/ColorPicker.svelte';
  import {
    CARD_SIZES,
    LIMITS,
    QUESTION_TYPES,
    REPORT_KIND_KEYS,
    TEXT_SIZES,
    styleOf
  } from '$lib/scouting/forms/formSchema.js';
  import { uploadFormImage } from '$lib/scouting/forms/formsClient.js';
  import { arrangeChoices, coreChoiceLists } from '$lib/scouting/forms/coreChoices.js';
  import { Eye, EyeOff } from 'lucide-svelte';
  import { PRESET_BRAND_COLORS } from '$lib/app/teamSettings.js';

  /** { kind: 'custom', question } or { kind: 'core', block, view }. */
  export let item;
  export let formType = 'match';
  export let sections = [];
  export let problems = [];
  export let readonly = false;

  const dispatch = createEventDispatcher();
  const KIND_LABELS = { data: 'Data', performance: 'Performance', robot: 'Robot' };
  let uploading = '';
  let uploadError = '';

  $: question = item?.kind === 'custom' ? item.question : null;
  $: view = item?.kind === 'core' ? item.view : null;
  $: block = item?.kind === 'core' ? item.block : null;
  $: style = styleOf(question || { style: view?.style });
  $: meta = question ? QUESTION_TYPES[question.type] : null;

  // A built-in block's answer lists, each in the admin's order (hidden answers stay listed so they can come back).
  $: choiceLists = block ? coreChoiceLists(formType, block.key) : [];
  $: hiddenChoices = new Set(view?.hiddenChoices || []);
  $: arranged = choiceLists.map((list) => ({
    ...list,
    options: list.fixed ? list.options : arrangeChoices({ choiceOrder: view?.choiceOrder }, list.options)
  }));
  const coreChange = (changes, group) => dispatch('core', { changes, group });
  function renameChoice(value, label) {
    coreChange({ choices: { ...(view.choices || {}), [value]: label } }, `choice-${value}`);
  }
  function toggleChoice(list, value) {
    const hidden = new Set(view.hiddenChoices || []);
    if (hidden.has(value)) hidden.delete(value);
    else {
      const shown = list.options.filter(([option]) => !hidden.has(option));
      if (shown.length <= 1) return;
      hidden.add(value);
    }
    coreChange({ hiddenChoices: [...hidden] });
  }
  function moveChoice(list, index, direction) {
    const values = list.options.map(([value]) => value);
    const to = index + direction;
    if (to < 0 || to >= values.length) return;
    [values[index], values[to]] = [values[to], values[index]];
    const others = arranged
      .filter((other) => !other.fixed && other.id !== list.id)
      .flatMap((other) => other.options.map(([value]) => value));
    coreChange({ choiceOrder: [...others, ...values] });
  }

  const patch = (changes, group) => dispatch('patch', { changes, group });
  const patchStyle = (changes) => dispatch('style', { ...style, ...changes });
  const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

  function setOption(index, changes, group) {
    patch({ options: question.options.map((o, i) => (i === index ? { ...o, ...changes } : o)) }, group);
  }
  function moveOption(index, direction) {
    const options = [...question.options];
    const to = index + direction;
    if (to < 0 || to >= options.length) return;
    [options[index], options[to]] = [options[to], options[index]];
    patch({ options });
  }
  function setRow(index, label) {
    patch({ rows: question.rows.map((r, i) => (i === index ? { ...r, label } : r)) }, `row-${index}`);
  }
  function toggleKind(kind) {
    const all = question.kinds?.length ? question.kinds : [...REPORT_KIND_KEYS];
    const next = all.includes(kind) ? all.filter((k) => k !== kind) : [...all, kind];
    if (!next.length) return;
    patch({ kinds: next.length === REPORT_KIND_KEYS.length ? undefined : REPORT_KIND_KEYS.filter((k) => next.includes(k)) });
  }

  async function upload(event, apply) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    uploadError = '';
    uploading = 'Uploading…';
    try {
      apply(await uploadFormImage(formType, file));
    } catch (cause) {
      uploadError = cause.message;
    } finally {
      uploading = '';
    }
  }
</script>

{#if !item}
  <div class="empty">
    <b>Nothing selected</b>
    <p>Click a card on the canvas to change it, or drag a question type from the left onto a section.</p>
  </div>
{:else}
  <div class="insp" class:readonly>
    <header class="insp-head">
      <span class="chip">{question ? meta?.label : 'Built-in'}</span>
      {#if question}
        <div class="insp-actions">
          <button class="icon" title="Move up" aria-label="Move up" on:click={() => dispatch('move', -1)}
            ><ArrowUp size={15} /></button
          >
          <button class="icon" title="Move down" aria-label="Move down" on:click={() => dispatch('move', 1)}
            ><ArrowDown size={15} /></button
          >
          <button class="icon" title="Duplicate" aria-label="Duplicate" on:click={() => dispatch('duplicate')}
            ><Copy size={15} /></button
          >
          <button class="icon danger" title="Delete" aria-label="Delete" on:click={() => dispatch('remove')}
            ><Trash2 size={15} /></button
          >
        </div>
      {:else}
        <div class="insp-actions">
          <button class="icon" title="Move up" aria-label="Move up" on:click={() => dispatch('move', -1)}
            ><ArrowUp size={15} /></button
          >
          <button class="icon" title="Move down" aria-label="Move down" on:click={() => dispatch('move', 1)}
            ><ArrowDown size={15} /></button
          >
          <button class="icon" title="Back to the built-in wording and look" aria-label="Reset" on:click={() => dispatch('reset')}
            ><RotateCcw size={15} /></button
          >
        </div>
      {/if}
    </header>

    {#if problems.length}
      <ul class="problems" role="alert">{#each problems as problem}<li>{problem}</li>{/each}</ul>
    {/if}

    <section class="group">
      <h4>Content</h4>
      {#if question}
        <label class="field"
          >Question
          <textarea
            class="form-input"
            rows="2"
            maxlength={LIMITS.label}
            value={question.label}
            placeholder="What should the scout answer?"
            on:input={(e) => patch({ label: e.currentTarget.value }, 'label')}
          ></textarea>
        </label>
        <label class="field"
          >Help text <span class="opt">(optional)</span>
          <textarea
            class="form-input"
            rows="2"
            maxlength={LIMITS.help}
            value={question.help}
            on:input={(e) => patch({ help: e.currentTarget.value }, 'help')}
          ></textarea>
        </label>
        <div class="row2">
          <label class="field"
            >Type
            <Select value={question.type} on:change={(e) => dispatch('convert', e.currentTarget.value)}>
              {#each Object.entries(QUESTION_TYPES) as [key, type] (key)}<option value={key}>{type.label}</option>{/each}
            </Select>
          </label>
          <label class="field"
            >Section
            <Select value={question.section} on:change={(e) => dispatch('section', e.currentTarget.value)}>
              {#each sections as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
            </Select>
          </label>
        </div>
        <label class="switch">
          <input type="checkbox" checked={question.required} on:change={(e) => patch({ required: e.currentTarget.checked })} />
          <span>Required</span>
        </label>
      {:else}
        <p class="note">{block.note || 'Part of the built-in form.'}</p>
        {#if block.rename}
          <label class="field"
            >Title
            <input
              class="form-input"
              maxlength={LIMITS.label}
              value={view.label}
              on:input={(e) => dispatch('core', { changes: { label: e.currentTarget.value }, group: 'label' })}
            />
          </label>
        {/if}
        <label class="field"
          >Help text
          <textarea
            class="form-input"
            rows="2"
            maxlength={LIMITS.help}
            value={view.help || ''}
            on:input={(e) => dispatch('core', { changes: { help: e.currentTarget.value }, group: 'help' })}
          ></textarea>
        </label>
        {#if block.optional}
          <label class="switch">
            <input
              type="checkbox"
              checked={!view.hidden}
              on:change={(e) => dispatch('core', { changes: { hidden: !e.currentTarget.checked } })}
            />
            <span>Show this on the form</span>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              checked={view.required}
              disabled={view.hidden}
              on:change={(e) => dispatch('core', { changes: { required: e.currentTarget.checked } })}
            />
            <span>Required</span>
          </label>
          <p class="note small">Hidden or optional, it is simply left empty in reports and exports.</p>
        {:else}
          <p class="note small">Every report needs the match and robot it is for, so this one always shows.</p>
        {/if}
      {/if}
    </section>

    {#if block && arranged.length}
      <section class="group" transition:slide={{ duration: 150 }}>
        <h4>Choices</h4>
        <p class="note small">
          Reword what the scout taps. Reports keep saving the same answer, so analysis and exports don't change.
        </p>
        {#each arranged as list (list.id)}
          {#if arranged.length > 1}<span class="list-title">{list.title}</span>{/if}
          <ul class="choice-list">
            {#each list.options as [value, label], index (value)}
              <li class:off={hiddenChoices.has(value)}>
                <input
                  class="form-input"
                  maxlength="60"
                  aria-label={`Wording for ${label}`}
                  value={view.choices?.[value] || label}
                  placeholder={label}
                  disabled={readonly}
                  on:input={(e) => renameChoice(value, e.currentTarget.value)}
                />
                {#if !list.fixed}
                  <button
                    class="icon"
                    type="button"
                    disabled={readonly}
                    title={hiddenChoices.has(value) ? 'Show this choice' : 'Hide this choice'}
                    aria-label={hiddenChoices.has(value) ? `Show ${label}` : `Hide ${label}`}
                    on:click={() => toggleChoice(list, value)}
                    >{#if hiddenChoices.has(value)}<EyeOff size={14} />{:else}<Eye size={14} />{/if}</button
                  >
                  <button
                    class="icon"
                    type="button"
                    disabled={readonly || index === 0}
                    aria-label={`Move ${label} up`}
                    on:click={() => moveChoice(list, index, -1)}><ArrowUp size={14} /></button
                  >
                  <button
                    class="icon"
                    type="button"
                    disabled={readonly || index === list.options.length - 1}
                    aria-label={`Move ${label} down`}
                    on:click={() => moveChoice(list, index, 1)}><ArrowDown size={14} /></button
                  >
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
        <p class="note small">Tip: double-click a choice on the form to rename it there.</p>
      </section>
    {/if}

    {#if question && meta?.options}
      <section class="group" transition:slide={{ duration: 150 }}>
        <h4>{question.type === 'grid' ? 'Columns (answers)' : 'Options'}</h4>
        {#each question.options as option, index (option.id)}
          <div class="option">
            <input
              class="form-input"
              maxlength={LIMITS.optionLabel}
              value={option.label}
              aria-label={`Option ${index + 1}`}
              on:input={(e) => setOption(index, { label: e.currentTarget.value }, `opt-${option.id}`)}
            />
            <ColorPicker
              label={`Color for ${option.label}`}
              value={option.color || ''}
              allowEmpty
              emptyLabel="—"
              presets={PRESET_BRAND_COLORS}
              on:change={(e) => setOption(index, { color: e.detail || undefined })}
            />
            <div class="opt-tools">
              {#if question.type === 'picture' || question.type === 'buttons'}
                <label class="icon" title="Picture for this option"
                  ><ImagePlus size={15} /><input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    on:change={(e) => upload(e, (url) => setOption(index, { image: url }))}
                  /></label
                >
              {/if}
              <button class="icon" aria-label="Up" on:click={() => moveOption(index, -1)}><ArrowUp size={14} /></button>
              <button
                class="icon danger"
                aria-label="Remove option"
                disabled={question.options.length <= 2}
                on:click={() => patch({ options: question.options.filter((_, i) => i !== index) })}><X size={14} /></button
              >
            </div>
            {#if option.image}
              <div class="opt-img">
                <img src={option.image} alt="" />
                <button class="link" on:click={() => setOption(index, { image: undefined })}>Remove picture</button>
              </div>
            {/if}
          </div>
        {/each}
        {#if question.options.length < LIMITS.options}
          <button
            class="add"
            on:click={() =>
              patch({ options: [...question.options, { id: newId('o'), label: `Option ${question.options.length + 1}` }] })}
            ><Plus size={14} /> Add option</button
          >
        {/if}
      </section>
    {/if}

    {#if question?.type === 'grid'}
      <section class="group">
        <h4>Rows</h4>
        {#each question.rows || [] as row, index (row.id)}
          <div class="option simple">
            <input
              class="form-input"
              maxlength={LIMITS.optionLabel}
              value={row.label}
              aria-label={`Row ${index + 1}`}
              on:input={(e) => setRow(index, e.currentTarget.value)}
            />
            <button
              class="icon danger"
              aria-label="Remove row"
              disabled={question.rows.length <= 1}
              on:click={() => patch({ rows: question.rows.filter((_, i) => i !== index) })}><X size={14} /></button
            >
          </div>
        {/each}
        {#if (question.rows || []).length < LIMITS.rows}
          <button
            class="add"
            on:click={() => patch({ rows: [...(question.rows || []), { id: newId('r'), label: `Row ${(question.rows || []).length + 1}` }] })}
            ><Plus size={14} /> Add row</button
          >
        {/if}
      </section>
    {/if}

    {#if question && ['rating', 'counter', 'number', 'slider'].includes(question.type)}
      <section class="group">
        <h4>Numbers</h4>
        <div class="row3">
          {#if question.type === 'rating'}
            <label class="field"
              >Highest rating
              <input
                class="form-input"
                type="number"
                min="3"
                max="10"
                value={question.max}
                on:change={(e) => patch({ max: Number(e.currentTarget.value) })}
              />
            </label>
          {:else}
            <label class="field"
              >Minimum
              <input
                class="form-input"
                type="number"
                value={question.min ?? ''}
                on:change={(e) => patch({ min: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
              />
            </label>
            <label class="field"
              >Maximum
              <input
                class="form-input"
                type="number"
                value={question.max ?? ''}
                on:change={(e) => patch({ max: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })}
              />
            </label>
            {#if question.type === 'slider'}
              <label class="field"
                >Step
                <input
                  class="form-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={question.step}
                  on:change={(e) => patch({ step: Number(e.currentTarget.value) })}
                />
              </label>
            {/if}
          {/if}
        </div>
      </section>
    {/if}

    {#if question && formType === 'match'}
      <section class="group">
        <h4>Shown on</h4>
        <div class="seg">
          {#each REPORT_KIND_KEYS as kind (kind)}
            {@const on = !question.kinds?.length || question.kinds.includes(kind)}
            <button class:on aria-pressed={on} on:click={() => toggleKind(kind)}>{KIND_LABELS[kind]}</button>
          {/each}
        </div>
        <p class="note small">Which kinds of match scouting ask this question.</p>
      </section>
    {/if}

    <section class="group">
      <h4>Look</h4>
      <span class="label">Card width</span>
      <div class="seg wrap">
        {#each CARD_SIZES as size (size.key)}
          <button class:on={style.size === size.key} on:click={() => patchStyle({ size: size.key })}>{size.label}</button>
        {/each}
      </div>
      <span class="label">Text size</span>
      <div class="seg">
        {#each TEXT_SIZES as size (size.key)}
          <button class:on={style.textSize === size.key} on:click={() => patchStyle({ textSize: size.key })}
            >{size.label}</button
          >
        {/each}
      </div>
      <span class="label">Accent color</span>
      <ColorPicker
        label="Accent color"
        value={style.accent}
        allowEmpty
        emptyLabel="Team brand color"
        presets={PRESET_BRAND_COLORS}
        on:change={(e) => patchStyle({ accent: e.detail })}
      />
      {#if question}
        <span class="label">Picture</span>
        {#if style.image}
          <div class="opt-img">
            <img src={style.image} alt="" />
            <button class="link" on:click={() => patchStyle({ image: '' })}>Remove picture</button>
          </div>
        {/if}
        <label class="btn btn-outline btn-sm upload"
          ><ImagePlus size={15} /> {style.image ? 'Replace picture' : 'Add a picture'}<input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            on:change={(e) => upload(e, (url) => patchStyle({ image: url }))}
          /></label
        >
      {/if}
      {#if uploading}<p class="note small">{uploading}</p>{/if}
      {#if uploadError}<p class="note small err">{uploadError}</p>{/if}
    </section>
  </div>
{/if}

<style>
  .empty {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-5);
    color: var(--text-secondary);
    text-align: center;
  }
  .empty p {
    margin: 0;
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .insp {
    display: grid;
    gap: var(--space-4);
  }
  .insp.readonly {
    pointer-events: none;
    opacity: 0.6;
  }
  .insp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .chip {
    padding: 0.15rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
  .insp-actions {
    display: flex;
    gap: 4px;
  }
  .icon {
    display: inline-grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon:hover:not(:disabled) {
    color: var(--text);
  }
  .icon.danger:hover:not(:disabled) {
    color: var(--danger);
  }
  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .problems {
    margin: 0;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-5);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--danger) 12%, var(--surface-1));
    font-size: 0.82rem;
  }
  .group {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .group h4 {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .field {
    display: grid;
    gap: 4px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .field textarea {
    resize: vertical;
    min-height: 2.6rem;
  }
  .label {
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .opt {
    color: var(--text-muted);
    font-weight: 400;
  }
  .row2,
  .row3 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .row3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .switch {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.88rem;
    cursor: pointer;
  }
  .switch input {
    accent-color: var(--accent);
  }
  .note {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .note.small {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .note.err {
    color: var(--danger);
  }
  .option {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--space-1);
    align-items: center;
  }
  .option.simple {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .option :global(.cp-field) {
    min-height: 2.25rem;
    padding-right: 0.5rem;
  }
  .option :global(.cp-text) {
    display: none;
  }
  .opt-tools {
    display: flex;
    gap: 2px;
  }
  .opt-img {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .opt-img img {
    width: 3.5rem;
    height: 2.6rem;
    object-fit: cover;
    border-radius: var(--radius-sm);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8rem;
    text-decoration: underline;
    cursor: pointer;
  }
  .add {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    justify-self: start;
    padding: 0.3rem 0.7rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .add:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .seg {
    display: inline-flex;
    justify-self: start;
    flex-wrap: nowrap;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
  }
  .seg.wrap {
    flex-wrap: wrap;
    border-radius: var(--radius-lg);
  }
  .seg button {
    min-height: 1.9rem;
    padding: 0 0.7rem;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .seg button.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--text-strong, var(--text));
  }
  .upload {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
  }
  .list-title {
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .choice-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .choice-list li {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .choice-list li .form-input {
    flex: 1;
    min-width: 0;
  }
  .choice-list li.off .form-input {
    opacity: 0.5;
    text-decoration: line-through;
  }
</style>

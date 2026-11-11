<script>
  import { Check, Minus, Plus } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { CARD_SIZES, LIMITS, TEXT_SIZES, shownOnKind, styleOf } from '$lib/scouting/forms/formSchema.js';

  // Renders the questions an admin added to a form, exactly as a scout answers them. The scouting
  // pages and the editor's live preview both use it, so what the admin sees is what the scout gets.
  export let questions = [];
  export let answers = {};
  export let disabled = false;
  // Highlights unanswered required questions (set once the scout tries to move on).
  export let showMissing = false;
  // Position of each question among the built-in ones (question id to order), when the page lays them out together.
  export let orders = null;
  // The kind of match scouting on screen (data, performance, robot); questions limited to other kinds are left out.
  export let kind = '';

  $: shown = questions.filter((question) => shownOnKind(question, kind));

  // A card's look from its style: width in the 12-column grid, text scale, accent color.
  function cardStyle(question) {
    const style = styleOf(question);
    const span = CARD_SIZES.find((size) => size.key === style.size)?.span;
    const scale = TEXT_SIZES.find((size) => size.key === style.textSize)?.scale ?? 1;
    return [
      orders ? `order:${orders.get(question.id) ?? 0}` : '',
      span ? `--span:${span}` : '',
      `--cq-scale:${scale}`,
      style.accent ? `--cq-accent:${style.accent}` : ''
    ]
      .filter(Boolean)
      .join(';');
  }
  const setGrid = (question, rowId, optionId) => {
    const current = answers[question.id] && typeof answers[question.id] === 'object' ? answers[question.id] : {};
    const next = { ...current };
    if (next[rowId] === optionId) delete next[rowId];
    else next[rowId] = optionId;
    Object.keys(next).length ? set(question.id, next) : clear(question.id);
  };

  const set = (id, value) => {
    if (!disabled) answers = { ...answers, [id]: value };
  };
  const clear = (id) => {
    const { [id]: _removed, ...rest } = answers;
    answers = rest;
  };
  const toggle = (id, value) => (answers[id] === value ? clear(id) : set(id, value));
  const toggleMany = (id, optionId) => {
    const current = Array.isArray(answers[id]) ? answers[id] : [];
    const next = current.includes(optionId) ? current.filter((entry) => entry !== optionId) : [...current, optionId];
    next.length ? set(id, next) : clear(id);
  };
  const step = (question, direction) => {
    const current = answers[question.id] ?? 0;
    let next = current + direction;
    if (question.min != null) next = Math.max(question.min, next);
    if (question.max != null) next = Math.min(question.max, next);
    set(question.id, next);
  };
  const missing = (question) =>
    showMissing &&
    question.required &&
    (answers[question.id] === undefined ||
      answers[question.id] === '' ||
      (Array.isArray(answers[question.id]) && !answers[question.id].length));
</script>

{#each shown as question (question.id)}
  {@const look = styleOf(question)}
  <section
    data-design-id={question.id}
    class="cq"
    class:missing={missing(question)}
    style={cardStyle(question)}
    aria-labelledby={`cq-${question.id}`}
  >
    <header class="cq-head">
      <span id={`cq-${question.id}`} class="cq-label">{question.label || 'Untitled question'}</span>
      <span class="cq-tag" class:req={question.required}>{question.required ? 'Required' : 'Optional'}</span>
    </header>
    {#if question.help}<p class="cq-help">{question.help}</p>{/if}
    {#if look.image}<img class="cq-img" src={look.image} alt="" loading="lazy" />{/if}

    {#if question.type === 'buttons'}
      <div class="cq-buttons" role="group" aria-labelledby={`cq-${question.id}`}>
        {#each question.options as option (option.id)}
          <button
            type="button"
            class="cq-btn"
            class:chosen={answers[question.id] === option.id}
            aria-pressed={answers[question.id] === option.id}
            style={option.color ? `--opt:${option.color}` : undefined}
            {disabled}
            on:click={() => toggle(question.id, option.id)}>{option.label}</button
          >
        {/each}
      </div>
    {:else if question.type === 'picture'}
      <div class="cq-pictures" role="radiogroup" aria-labelledby={`cq-${question.id}`}>
        {#each question.options as option (option.id)}
          <button
            type="button"
            role="radio"
            class="cq-pic"
            class:chosen={answers[question.id] === option.id}
            aria-checked={answers[question.id] === option.id}
            style={option.color ? `--opt:${option.color}` : undefined}
            {disabled}
            on:click={() => toggle(question.id, option.id)}
          >
            {#if option.image}<img src={option.image} alt="" loading="lazy" />{:else}<span class="cq-pic-empty"
              ></span>{/if}
            <span>{option.label}</span>
          </button>
        {/each}
      </div>
    {:else if question.type === 'grid'}
      <div class="cq-grid" style={`--cols:${question.options.length}`} role="group" aria-labelledby={`cq-${question.id}`}>
        <span></span>
        {#each question.options as option (option.id)}<span class="cq-grid-head">{option.label}</span>{/each}
        {#each question.rows || [] as row (row.id)}
          <span class="cq-grid-row">{row.label}</span>
          {#each question.options as option (option.id)}
            {@const on = answers[question.id]?.[row.id] === option.id}
            <button
              type="button"
              class="cq-btn cq-grid-cell"
              class:chosen={on}
              aria-pressed={on}
              aria-label={`${row.label}: ${option.label}`}
              style={option.color ? `--opt:${option.color}` : undefined}
              {disabled}
              on:click={() => setGrid(question, row.id, option.id)}>{option.label}</button
            >
          {/each}
        {/each}
      </div>
    {:else if question.type === 'slider'}
      <div class="cq-slider">
        <output class="cq-count" class:unset={answers[question.id] === undefined}
          >{answers[question.id] ?? '—'}</output
        >
        <input
          type="range"
          min={question.min}
          max={question.max}
          step={question.step || 1}
          value={answers[question.id] ?? question.min}
          {disabled}
          aria-labelledby={`cq-${question.id}`}
          on:input={(event) => set(question.id, Number(event.currentTarget.value))}
        />
        <div class="cq-slider-ends"><span>{question.min}</span><span>{question.max}</span></div>
      </div>
    {:else if question.type === 'mcq'}
      <div class="cq-list" role="radiogroup" aria-labelledby={`cq-${question.id}`}>
        {#each question.options as option (option.id)}
          <button
            type="button"
            role="radio"
            class="cq-row"
            class:chosen={answers[question.id] === option.id}
            aria-checked={answers[question.id] === option.id}
            {disabled}
            on:click={() => toggle(question.id, option.id)}
          >
            <i class="cq-dot" aria-hidden="true"></i><span>{option.label}</span>
          </button>
        {/each}
      </div>
    {:else if question.type === 'checkboxes'}
      <div class="cq-list" role="group" aria-labelledby={`cq-${question.id}`}>
        {#each question.options as option (option.id)}
          {@const on = (answers[question.id] || []).includes(option.id)}
          <button
            type="button"
            role="checkbox"
            class="cq-row"
            class:chosen={on}
            aria-checked={on}
            {disabled}
            on:click={() => toggleMany(question.id, option.id)}
          >
            <i class="cq-box" aria-hidden="true"
              >{#if on}<Check size={13} />{/if}</i
            ><span>{option.label}</span>
          </button>
        {/each}
      </div>
    {:else if question.type === 'dropdown'}
      <Select
        class="form-input"
        value={answers[question.id] ?? ''}
        {disabled}
        on:change={(event) => (event.target.value ? set(question.id, event.target.value) : clear(question.id))}
        aria-labelledby={`cq-${question.id}`}
      >
        <option value="" disabled>Choose one</option>
        {#each question.options as option (option.id)}<option value={option.id}>{option.label}</option>{/each}
      </Select>
    {:else if question.type === 'yesno'}
      <div class="cq-buttons two" role="group" aria-labelledby={`cq-${question.id}`}>
        <button
          type="button"
          class="cq-btn"
          class:chosen={answers[question.id] === true}
          aria-pressed={answers[question.id] === true}
          {disabled}
          on:click={() => toggle(question.id, true)}>Yes</button
        >
        <button
          type="button"
          class="cq-btn"
          class:chosen={answers[question.id] === false}
          aria-pressed={answers[question.id] === false}
          {disabled}
          on:click={() => toggle(question.id, false)}>No</button
        >
      </div>
    {:else if question.type === 'rating'}
      <div class="cq-scale" style={`--cols:${question.max || 5}`} role="group" aria-labelledby={`cq-${question.id}`}>
        {#each Array.from({ length: question.max || 5 }, (_, index) => index + 1) as value}
          <button
            type="button"
            class="cq-btn"
            class:chosen={answers[question.id] === value}
            aria-pressed={answers[question.id] === value}
            {disabled}
            on:click={() => toggle(question.id, value)}>{value}</button
          >
        {/each}
      </div>
    {:else if question.type === 'counter'}
      <div class="cq-counter">
        <button
          type="button"
          class="cq-step"
          aria-label="Decrease"
          disabled={disabled || (question.min != null && (answers[question.id] ?? 0) <= question.min)}
          on:click={() => step(question, -1)}><Minus size={18} /></button
        >
        <output class="cq-count" class:unset={answers[question.id] === undefined}>{answers[question.id] ?? 0}</output>
        <button
          type="button"
          class="cq-step"
          aria-label="Increase"
          disabled={disabled || (question.max != null && (answers[question.id] ?? 0) >= question.max)}
          on:click={() => step(question, 1)}><Plus size={18} /></button
        >
        {#if answers[question.id] !== undefined}<button
            type="button"
            class="cq-clear"
            {disabled}
            on:click={() => clear(question.id)}>Clear</button
          >{/if}
      </div>
    {:else if question.type === 'number'}
      <input
        class="form-input cq-input"
        type="number"
        inputmode="decimal"
        min={question.min ?? undefined}
        max={question.max ?? undefined}
        {disabled}
        value={answers[question.id] ?? ''}
        aria-labelledby={`cq-${question.id}`}
        on:input={(event) =>
          event.target.value === '' ? clear(question.id) : set(question.id, Number(event.target.value))}
      />
    {:else if question.type === 'text'}
      <input
        class="form-input cq-input"
        type="text"
        maxlength={LIMITS.text}
        {disabled}
        value={answers[question.id] ?? ''}
        aria-labelledby={`cq-${question.id}`}
        on:input={(event) => (event.target.value ? set(question.id, event.target.value) : clear(question.id))}
      />
    {:else if question.type === 'frq'}
      <textarea
        class="form-input cq-area"
        rows="4"
        maxlength={LIMITS.frq}
        {disabled}
        value={answers[question.id] ?? ''}
        aria-labelledby={`cq-${question.id}`}
        on:input={(event) => (event.target.value ? set(question.id, event.target.value) : clear(question.id))}
      ></textarea>
    {/if}
    {#if missing(question)}<small class="cq-missing" role="alert">Answer this to continue.</small>{/if}
  </section>
{/each}

<style>
  .cq {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    min-width: 0;
    font-size: calc(1rem * var(--cq-scale, 1));
  }
  .cq-img {
    width: 100%;
    max-height: 14rem;
    object-fit: contain;
    border-radius: var(--radius-md);
    background: var(--surface-1);
  }
  /* An option's own color, when the designer gave it one, wins over the card's accent. */
  .cq-btn.chosen[style*='--opt'],
  .cq-pic.chosen[style*='--opt'] {
    border-color: var(--opt);
    background: color-mix(in srgb, var(--opt) 22%, var(--surface-1));
  }
  .cq-pictures {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: var(--space-2);
  }
  .cq-pic {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .cq-pic img,
  .cq-pic-empty {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
  }
  .cq-pic.chosen {
    border-color: var(--cq-accent, var(--accent));
    background: color-mix(in srgb, var(--cq-accent, var(--accent)) 16%, var(--surface-1));
  }
  .cq-grid {
    display: grid;
    grid-template-columns: minmax(5rem, auto) repeat(var(--cols), minmax(0, 1fr));
    gap: var(--space-1);
    align-items: center;
  }
  .cq-grid-head {
    color: var(--text-muted);
    font-size: 0.75em;
    text-align: center;
  }
  .cq-grid-row {
    color: var(--text-secondary);
    font-size: 0.85em;
  }
  .cq-grid-cell {
    min-height: 2.4rem;
    padding: 0 var(--space-1);
    font-size: 0.85em;
  }
  .cq-slider {
    display: grid;
    gap: var(--space-1);
  }
  .cq-slider input {
    width: 100%;
    accent-color: var(--cq-accent, var(--accent));
  }
  .cq-slider-ends {
    display: flex;
    justify-content: space-between;
    color: var(--text-muted);
    font-size: 0.75em;
  }
  .cq.missing {
    border-color: var(--red-base);
  }
  .cq-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .cq-label {
    font-size: 0.95em;
    font-weight: 600;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .cq-tag {
    flex: none;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-size: 0.66rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .cq-tag.req {
    border-color: var(--cq-accent, var(--accent));
    color: var(--cq-accent, var(--accent));
  }
  .cq-help {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }
  .cq-missing {
    color: var(--red-base);
  }

  .cq-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .cq-buttons.two {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 20rem;
  }
  .cq-scale {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: var(--space-2);
    max-width: 30rem;
  }
  .cq-btn {
    min-height: 2.9rem;
    padding: 0 var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      background-color 0.12s ease,
      transform 0.1s ease;
  }
  .cq-btn:hover:not(:disabled) {
    border-color: var(--cq-accent, var(--accent));
  }
  .cq-btn.chosen {
    border-color: var(--cq-accent, var(--accent));
    background: color-mix(in srgb, var(--cq-accent, var(--accent)) 16%, var(--surface-1));
    color: var(--secondary);
    font-weight: 600;
    transform: translateY(-1px);
  }

  .cq-list {
    display: grid;
    gap: var(--space-1);
  }
  .cq-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 2.75rem;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      background-color 0.12s ease;
  }
  .cq-row:hover:not(:disabled) {
    border-color: var(--cq-accent, var(--accent));
  }
  .cq-row.chosen {
    border-color: var(--cq-accent, var(--accent));
    background: color-mix(in srgb, var(--cq-accent, var(--accent)) 16%, var(--surface-1));
  }
  .cq-dot,
  .cq-box {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.1rem;
    height: 1.1rem;
    border: 2px solid var(--text-muted);
  }
  .cq-dot {
    border-radius: 50%;
  }
  .cq-box {
    border-radius: 4px;
  }
  .cq-row.chosen .cq-dot {
    border-color: var(--cq-accent, var(--accent));
    background: radial-gradient(circle, var(--cq-accent, var(--accent)) 45%, transparent 50%);
  }
  .cq-row.chosen .cq-box {
    border-color: var(--cq-accent, var(--accent));
    background: var(--cq-accent, var(--accent));
    color: var(--surface-1);
  }

  .cq-counter {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .cq-step {
    display: grid;
    place-items: center;
    width: 3.25rem;
    height: 3.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text);
    cursor: pointer;
  }
  .cq-step:hover:not(:disabled) {
    border-color: var(--cq-accent, var(--accent));
  }
  .cq-step:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .cq-count {
    min-width: 3.5rem;
    text-align: center;
    font-size: 1.6rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cq-count.unset {
    color: var(--text-muted);
  }
  .cq-clear {
    border: 0;
    background: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.8rem;
    text-decoration: underline;
    cursor: pointer;
  }
  .cq-input {
    max-width: 22rem;
  }
  .cq-area {
    min-height: 6rem;
    resize: vertical;
    line-height: 1.5;
  }
  @media (max-width: 480px) {
    .cq {
      padding: var(--space-3);
    }
    .cq-btn {
      flex: 1 1 8rem;
    }
  }
</style>

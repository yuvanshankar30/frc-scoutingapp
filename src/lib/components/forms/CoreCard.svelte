<script>
  import { createEventDispatcher } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import { ChevronDown, ChevronUp, EyeOff, GripVertical, Lock, RotateCcw } from 'lucide-svelte';
  import { LIMITS } from '$lib/scouting/forms/formSchema.js';

  // One of the form's built-in questions. It can be reworded and moved; whether it can also be hidden depends on
  // whether the saved report needs its answer.
  export let item;
  export let index = 0;
  export let count = 1;
  export let expanded = false;
  export let readonly = false;
  export let change = false;
  export let motion = true;

  const dispatch = createEventDispatcher();
  const dur = (ms) => (motion ? ms : 0);
  $: block = item.block;
  $: view = item.view;
  $: customized = view.renamed || view.helpChanged || view.hidden;
  const patch = (changes, group = null) => dispatch('patch', { changes, group });
</script>

<article
  class="cc"
  class:open={expanded}
  class:readonly
  class:hidden={view.hidden}
  data-change={change ? 'edited' : null}
>
  <div class="cc-bar">
    {#if !readonly}<span class="cc-grip qc-grip" title="Drag to reorder" aria-hidden="true"
        ><GripVertical size={16} /></span
      >{/if}
    <button type="button" class="cc-head" aria-expanded={expanded} on:click={() => dispatch('toggle')}>
      <span class="cc-icon"><Lock size={15} /></span>
      <span class="cc-title">{view.label}</span>
      <span class="cc-tags">
        {#if change}<span class="cc-pill edited" transition:fade={{ duration: dur(120) }}>Edited</span>{/if}
        {#if view.hidden}<span class="cc-pill off"><EyeOff size={12} /> Hidden</span>{/if}
        <span class="cc-pill">Built-in</span>
        {#if !block.optional}<span class="cc-pill req">Required</span>{/if}
      </span>
      <span class="cc-chevron" class:flip={expanded}><ChevronDown size={16} /></span>
    </button>
    {#if !readonly}
      <div class="cc-move">
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
    <div class="cc-body" transition:slide={{ duration: dur(180) }}>
      {#if block.note}<p class="cc-note">{block.note}</p>{/if}
      <div class="cc-grid">
        {#if block.rename}
          <label class="cc-field wide">
            <span>Question wording <em>default: {block.label}</em></span>
            <input
              class="form-input"
              type="text"
              maxlength={LIMITS.label}
              value={view.renamed ? view.label : ''}
              placeholder={block.label}
              disabled={readonly}
              on:input={(event) => patch({ label: event.target.value }, `label:${block.key}`)}
            />
          </label>
        {:else}
          <p class="cc-fixed wide">The wording of this block is fixed because it is several questions in one.</p>
        {/if}
        {#if block.help !== null}
          <label class="cc-field wide">
            <span>Help text <em>clear it to show none</em></span>
            <input
              class="form-input"
              type="text"
              maxlength={LIMITS.help}
              value={view.help ?? ''}
              disabled={readonly}
              on:input={(event) => patch({ help: event.target.value }, `help:${block.key}`)}
            />
          </label>
        {/if}
        <div class="cc-field wide">
          <span>Visibility</span>
          {#if block.optional}
            <button
              type="button"
              class="cc-switch"
              role="switch"
              aria-checked={!view.hidden}
              disabled={readonly}
              on:click={() => patch({ hidden: !view.hidden })}
            >
              <i aria-hidden="true"></i><b>{view.hidden ? 'Hidden from scouts' : 'Shown to scouts'}</b>
            </button>
          {:else}
            <p class="cc-fixed">
              <Lock size={13} /> Always shown: the saved report needs this answer. You can still reword it and move it.
            </p>
          {/if}
        </div>
      </div>
      {#if !readonly && customized}
        <footer class="cc-foot">
          <button type="button" class="btn btn-outline btn-sm" on:click={() => dispatch('reset')}
            ><RotateCcw size={14} /> Back to the default</button
          >
        </footer>
      {/if}
    </div>
  {/if}
</article>

<style>
  .cc {
    border: 1px dashed var(--border);
    border-left: 3px solid var(--text-muted);
    background: color-mix(in srgb, var(--surface-2) 70%, var(--surface-1));
    transition:
      border-color 0.16s ease,
      box-shadow 0.16s ease,
      opacity 0.16s ease;
  }
  .cc:hover {
    border-color: color-mix(in srgb, var(--brand-gold-strong) 45%, var(--border));
  }
  .cc.open {
    border-style: solid;
    border-color: var(--brand-gold-strong);
    box-shadow: var(--shadow-card);
  }
  .cc[data-change='edited'] {
    border-left-color: var(--brand-gold-strong);
  }
  .cc.hidden {
    opacity: 0.6;
  }
  .cc-bar {
    display: flex;
    align-items: stretch;
  }
  .cc-grip {
    display: grid;
    place-items: center;
    width: 1.9rem;
    color: var(--text-muted);
    cursor: grab;
  }
  .cc.readonly .cc-bar {
    padding-left: var(--space-2);
  }
  .cc-head {
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
  .cc-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--text-muted);
  }
  .cc-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 0.92rem;
  }
  .cc-tags {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex: none;
  }
  .cc-pill {
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
  .cc-pill.req {
    border-color: var(--brand-gold-strong);
    color: var(--brand-gold-strong);
  }
  .cc-pill.edited {
    border-color: var(--brand-gold-strong);
    color: var(--brand-gold-strong);
  }
  .cc-pill.off {
    border-color: var(--red-base);
    color: var(--red-base);
  }
  .cc-chevron {
    flex: none;
    display: grid;
    color: var(--text-muted);
    transition: transform 0.18s ease;
  }
  .cc-chevron.flip {
    transform: rotate(180deg);
  }
  .cc-move {
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
  .cc-body {
    padding: 0 var(--space-4) var(--space-4);
    border-top: 1px solid var(--border);
  }
  .cc-note {
    margin: var(--space-3) 0 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }
  .cc-grid {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }
  .cc-field {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }
  .cc-field > span {
    color: var(--text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .cc-field > span em {
    text-transform: none;
    letter-spacing: 0;
    font-style: normal;
    opacity: 0.75;
    margin-left: 0.35rem;
  }
  .cc-fixed {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .cc-switch {
    justify-self: start;
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
  .cc-switch i {
    position: relative;
    width: 2.1rem;
    height: 1.15rem;
    border-radius: 999px;
    background: var(--border);
    transition: background-color 0.16s ease;
  }
  .cc-switch i::after {
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
  .cc-switch[aria-checked='true'] i {
    background: var(--brand-gold-strong);
  }
  .cc-switch[aria-checked='true'] i::after {
    transform: translateX(0.95rem);
    background: var(--surface-1);
  }
  .cc-foot {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .cc-foot :global(.btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  @media (max-width: 640px) {
    .cc-tags .cc-pill:not(.off):not(.req) {
      display: none;
    }
  }

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .cc-title {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

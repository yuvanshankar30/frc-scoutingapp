<script>
  // A panel that slides up from the bottom of a phone screen, for details that a desktop shows in a
  // side panel. Closes from the X, the backdrop, Escape, or by dragging the handle down.
  import { createEventDispatcher, tick } from 'svelte';
  import { X } from 'lucide-svelte';
  import { portal } from '$lib/app/portal.js';

  export let open = false;
  export let title = '';
  /** Short line under the title. */
  export let subtitle = '';

  const dispatch = createEventDispatcher();
  let panel;
  let dragY = 0;
  let dragStart = null;

  const close = () => dispatch('close');

  $: if (open) void focusPanel();
  async function focusPanel() {
    await tick();
    panel?.focus({ preventScroll: true });
  }

  function onKey(event) {
    if (open && event.key === 'Escape') close();
  }

  function startDrag(event) {
    dragStart = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function moveDrag(event) {
    if (dragStart == null) return;
    dragY = Math.max(0, event.clientY - dragStart);
  }
  function endDrag() {
    if (dragStart == null) return;
    // Dragged far enough down: close. Otherwise spring back.
    if (dragY > 90) close();
    dragStart = null;
    dragY = 0;
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="sheet-root" use:portal data-no-reveal>
    <div class="backdrop" role="presentation" on:click={close}></div>
    <div
      class="panel"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      bind:this={panel}
      style={dragY ? `transform:translateY(${dragY}px);transition:none` : ''}
    >
      <div
        class="handle-zone"
        role="presentation"
        on:pointerdown={startDrag}
        on:pointermove={moveDrag}
        on:pointerup={endDrag}
        on:pointercancel={endDrag}
      >
        <span class="grip" aria-hidden="true"></span>
        <div class="head">
          <div class="titles">
            {#if title}<h2>{title}</h2>{/if}
            {#if subtitle}<p>{subtitle}</p>{/if}
          </div>
          <button
            type="button"
            class="close"
            aria-label="Close"
            on:click|stopPropagation={close}
            on:pointerdown|stopPropagation><X size={20} /></button
          >
        </div>
      </div>
      <div class="body"><slot /></div>
      {#if $$slots.actions}<div class="actions"><slot name="actions" /></div>{/if}
    </div>
  </div>
{/if}

<style>
  .sheet-root {
    position: fixed;
    inset: 0;
    z-index: 60;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--modal-overlay);
    animation: fade 0.18s ease-out;
  }
  .panel {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    max-height: calc(90 * var(--vh, 1vh));
    background: var(--surface-1);
    border-top: 1px solid var(--border);
    border-radius: 18px 18px 0 0;
    box-shadow: var(--shadow-sheet);
    outline: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    transition: transform 0.2s ease;
    animation: rise 0.22s cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  .handle-zone {
    flex: none;
    padding: 8px 16px 4px;
    touch-action: none;
    cursor: grab;
  }
  .grip {
    display: block;
    width: 40px;
    height: 5px;
    margin: 0 auto 8px;
    border-radius: 999px;
    background: var(--border);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 1.2rem;
  }
  p {
    margin: 2px 0 0;
    color: var(--text-secondary);
    font-size: 0.88rem;
  }
  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin: -6px -8px 0 0;
    border: 0;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 8px 16px 16px;
  }
  .actions {
    flex: none;
    display: flex;
    gap: 8px;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--border);
  }
  .actions :global(> *) {
    flex: 1;
    min-height: 48px;
    justify-content: center;
  }
  @keyframes rise {
    from {
      transform: translateY(100%);
    }
    to {
      transform: none;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel,
    .backdrop {
      animation: none;
      transition: none;
    }
  }
</style>

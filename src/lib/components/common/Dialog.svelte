<script>
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { X } from 'lucide-svelte';
  import { portal } from '$lib/app/portal.js';

  // A popup over the page. Closes on Escape, on the X, or on a click outside it.
  export let open = false;
  export let title = '';
  export let subtitle = '';
  export let width = '56rem';

  const dispatch = createEventDispatcher();
  let panel;
  let previousOverflow = '';

  function close() {
    open = false;
    dispatch('close');
  }

  // Keep the page behind from scrolling while the popup is open.
  $: if (typeof document !== 'undefined') {
    if (open) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow;
  }
  $: if (open && panel) panel.focus();
  onDestroy(() => {
    if (typeof document !== 'undefined') document.body.style.overflow = previousOverflow;
  });
</script>

<svelte:window
  on:keydown={(event) => {
    if (open && event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }}
/>

{#if open}
  <div class="backdrop" role="presentation" use:portal data-no-reveal on:pointerdown|self={close}>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
      bind:this={panel}
      style={`--dialog-width:${width}`}
    >
      <header>
        <div class="heading">
          <h3>{title}</h3>
          {#if subtitle}<p>{subtitle}</p>{/if}
        </div>
        <button type="button" class="close" aria-label="Close" on:click={close}><X size={18} /></button>
      </header>
      <div class="body"><slot /></div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: grid;
    place-items: center;
    padding: var(--space-5);
    background: var(--modal-overlay);
    animation: fade 0.14s ease-out;
  }
  .dialog {
    width: min(var(--dialog-width), 100%);
    max-height: min(calc(90 * var(--vh)), 60rem);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    box-shadow: var(--shadow-dialog);
    outline: none;
    animation: rise 0.16s ease-out;
    overflow: hidden;
  }
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border);
  }
  h3 {
    margin: 0;
    font-size: 1.15rem;
  }
  .heading p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .close {
    min-width: 0;
    min-height: 0;
    display: grid;
    place-items: center;
    width: 2.2rem;
    height: 2.2rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .close:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-4) var(--space-5) var(--space-5);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (max-width: 700px) {
    .backdrop {
      padding: var(--space-2);
    }
    .body {
      padding: var(--space-3);
    }
  }
</style>

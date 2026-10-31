<script>
  import { confirmation, resolveConfirmation } from '$lib/app/confirmation.js';

  let typed = '';
  $: config = $confirmation;
  $: if (!config) typed = '';
  $: canConfirm = !config?.requireText || typed.trim() === config.requireText;

  const close = () => resolveConfirmation(false);
  const confirm = () => {
    if (canConfirm) resolveConfirmation(true);
  };
</script>

<svelte:window
  on:keydown={(event) => {
    if (config && event.key === 'Escape') close();
  }}
/>

{#if config}
  <div class="confirm-backdrop" role="presentation" on:click|self={close}>
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
      <h2 id="confirmation-title">{config.title}</h2>
      <p>{config.message}</p>
      {#if config.requireText}
        <label>
          Type <strong>{config.requireText}</strong> to continue
          <!-- svelte-ignore a11y-autofocus -->
          <input
            class="form-input"
            bind:value={typed}
            autocomplete="off"
            autofocus
            on:keydown={(event) => {
              if (event.key === 'Enter') confirm();
            }}
          />
        </label>
      {/if}
      <div class="confirm-actions">
        <button type="button" class="btn btn-outline" on:click={close}>Cancel</button>
        <button
          type="button"
          class="btn"
          class:btn-danger={config.danger}
          class:btn-primary={!config.danger}
          disabled={!canConfirm}
          on:click={confirm}>{config.confirmLabel}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1600;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: var(--modal-overlay);
  }
  .confirm-dialog {
    width: min(100%, 30rem);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--shadow-dialog);
  }
  .confirm-dialog h2 {
    margin: 0 0 var(--space-2);
    font-size: 1.15rem;
  }
  .confirm-dialog p {
    margin: 0;
    color: var(--text-secondary);
    white-space: pre-wrap;
    line-height: 1.5;
  }
  .confirm-dialog label {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-4);
    font-size: 0.9rem;
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
</style>

<script>
  import { AlertTriangle, CloudOff, Download, RefreshCw } from 'lucide-svelte';
  import {
    exportQueuedJobsJson,
    failedSyncCount,
    flushQueue,
    lastSyncError,
    pendingSyncCount
  } from '$lib/app/offlineQueue.js';

  let syncing = false;
  async function syncNow() {
    syncing = true;
    try {
      await flushQueue();
    } finally {
      syncing = false;
    }
  }

  function downloadQueuedReports() {
    try {
      const json = exportQueuedJobsJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scouting-offline-queue-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // ignore download errors
    }
  }
</script>

{#if $pendingSyncCount > 0}
  <div class="offline-sync-group">
    <button
      type="button"
      class="offline-sync-badge"
      class:has-error={$failedSyncCount > 0}
      on:click={syncNow}
      disabled={syncing}
      title={$lastSyncError
        ? `Sync failed: ${$lastSyncError}. Tap to retry.`
        : 'Reports saved on this phone, waiting for a connection to sync'}
    >
      {#if $failedSyncCount > 0}
        <AlertTriangle size={14} />
        <span>{$pendingSyncCount} waiting ({$lastSyncError || 'sync error'})</span>
      {:else}
        <CloudOff size={14} />
        <span>{$pendingSyncCount} waiting to sync</span>
      {/if}
      <RefreshCw size={13} class={syncing ? 'spinning' : ''} />
    </button>
    {#if $failedSyncCount > 0}
      <button
        type="button"
        class="offline-export-btn"
        on:click={downloadQueuedReports}
        title="Download queued scouting reports as JSON backup"
      >
        <Download size={13} />
        <span>Export JSON</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .offline-sync-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .offline-sync-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
    padding: 4px 10px;
    border: 1px solid var(--warning, #f1c331);
    border-radius: var(--radius-sm, 4px);
    background: color-mix(in srgb, var(--warning, #f1c331) 14%, transparent);
    color: var(--text, #101828);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .offline-sync-badge.has-error {
    border-color: var(--danger, #d92d20);
    background: color-mix(in srgb, var(--danger, #d92d20) 14%, transparent);
  }
  .offline-sync-badge:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }
  .offline-export-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--border, #d0d5dd);
    border-radius: var(--radius-sm, 4px);
    background: var(--surface, #ffffff);
    color: var(--text, #101828);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
  :global(.spinning) {
    animation: offline-sync-spin 0.8s linear infinite;
  }
  @keyframes offline-sync-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>

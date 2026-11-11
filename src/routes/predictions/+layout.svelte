<script>
  import Select from '$lib/components/common/Select.svelte';
  import { tick, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { ArrowLeftCircle, Trophy } from 'lucide-svelte';
  import { pmEvents, pmEventKey, pmLoadingEvents, pmMyElo, loadPmEvents } from '$lib/stores/predictionMarketEvent.js';

  onMount(loadPmEvents);

  const TABS = [
    { href: '/predictions', label: 'Dashboard', exact: true },
    { href: '/predictions/alliance-draft', label: 'Alliance Draft' },
    { href: '/predictions/mine', label: 'My Predictions' },
    { href: '/predictions/matches', label: 'Matches' },
    { href: '/predictions/leaderboard', label: 'Leaderboard' }
  ];

  $: path = $page.url.pathname;
  $: isTabActive = (tab) => (tab.exact ? path === tab.href : path.startsWith(tab.href));
  $: activeIndex = TABS.findIndex(isTabActive);

  // The underline slides to the active tab rather than just appearing there
  // - measuring the real tab element (bind:this) instead of hardcoding
  // widths, since each label is a different length.
  let tabEls = [];
  let indicatorLeft = 0;
  let indicatorWidth = 0;

  async function positionIndicator() {
    await tick();
    const el = tabEls[activeIndex];
    if (el) {
      indicatorLeft = el.offsetLeft;
      indicatorWidth = el.offsetWidth;
    }
  }

  $: (activeIndex, positionIndicator());
</script>

<div class="pm-shell">
  <header class="pm-topbar">
    <div class="pm-topbar-left">
      <a href="/predictions" class="pm-brand">
        <span class="pm-brand-name">Prediction Market</span>
      </a>
      {#if $pmEvents.length}
        <label class="pm-event-picker">
          <Select bare value={$pmEventKey} on:change={(e) => pmEventKey.set(e.currentTarget.value)}>
            {#each $pmEvents as event (event.key)}
              <option value={event.key}
                >{event.live ? '● LIVE — ' : ''}{event.short_name || event.name || event.key}</option
              >
            {/each}
          </Select>
        </label>
      {:else if !$pmLoadingEvents}
        <span class="pm-event-picker pm-event-empty">No current events</span>
      {/if}
    </div>

    <nav class="pm-tabs" aria-label="Prediction Market sections">
      {#each TABS as tab, i}
        <a href={tab.href} class="pm-tab" class:active={isTabActive(tab)} bind:this={tabEls[i]}>{tab.label}</a>
      {/each}
      <span class="pm-tab-indicator" style="left:{indicatorLeft}px; width:{indicatorWidth}px"></span>
    </nav>

    <div class="pm-topbar-right">
      <span class="pm-elo-badge" aria-label="Your current Elo rating">
        <Trophy size={13} />
        {$pmMyElo?.elo ?? '—'} Elo
      </span>
      <a href="/" class="pm-icon-link pm-return-link" title="Back to scouting"
        ><ArrowLeftCircle size={16} /> Back to scouting</a
      >
    </div>
  </header>

  <main class="pm-content">
    <slot />
  </main>
</div>

<style>
  /* Palette comes from the site's own tokens, so this section follows the active theme
     (dark, light, or pit board) like every other page. */
  .pm-shell {
    --pm-bg: transparent;
    --pm-surface: var(--surface-1);
    --pm-surface-raised: var(--surface-2);
    --pm-border: var(--border);
    --pm-border-soft: var(--divider);
    --pm-text: var(--text);
    --pm-muted: var(--text-muted);
    --pm-accent: var(--accent);
    --pm-accent-soft: var(--accent-subtle);
    --pm-red: color-mix(in srgb, var(--red-base) 55%, var(--text-secondary));
    --pm-red-soft: color-mix(in srgb, var(--red-base) 10%, transparent);
    --pm-blue: color-mix(in srgb, var(--blue-base) 55%, var(--text-secondary));
    --pm-blue-soft: color-mix(in srgb, var(--blue-base) 10%, transparent);
    --pm-green: color-mix(in srgb, var(--green-base) 55%, var(--text-secondary));
    --pm-green-soft: color-mix(in srgb, var(--green-base) 10%, transparent);
    --pm-font-mono: var(--font-mono);
    --pm-font-sans: inherit;

    min-height: calc(calc(100 * var(--vh)) - var(--strip-height) - 2 * var(--space-5));
    background: var(--pm-bg);
    color: var(--pm-text);
    font-family: var(--pm-font-sans);
    display: flex;
    flex-direction: column;
  }

  .pm-topbar {
    position: sticky;
    top: var(--strip-height);
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.65rem 1.25rem;
    background: var(--pm-surface);
    border-bottom: 1px solid var(--pm-border);
  }

  .pm-topbar-left {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    min-width: 0;
  }

  .pm-brand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--pm-text);
    font-family: var(--pm-font-mono);
    font-weight: 600;
    font-size: 0.95rem;
    white-space: nowrap;
  }

  .pm-event-picker {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.25rem 0.65rem;
    background: var(--pm-surface-raised);
    border: 1px solid var(--pm-border);
    font-family: var(--pm-font-mono);
    font-size: 0.78rem;
    white-space: nowrap;
  }
  .pm-event-empty {
    color: var(--pm-muted);
  }

  .pm-tabs {
    position: relative;
    display: flex;
    gap: 0.25rem;
    flex: 1;
    overflow-x: auto;
  }
  .pm-tab {
    padding: 0.5rem 0.85rem;
    color: var(--pm-muted);
    text-decoration: none;
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: color 0.12s ease;
  }
  .pm-tab:hover {
    color: var(--pm-text);
  }
  .pm-tab.active {
    color: var(--pm-accent);
  }

  /* The underline itself - one shared element that slides to whichever tab
     is active, instead of each tab drawing its own static border. */
  .pm-tab-indicator {
    position: absolute;
    bottom: 0;
    height: 2px;
    background: var(--pm-accent);
    transition:
      left 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .pm-topbar-right {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-shrink: 0;
  }
  .pm-elo-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.6rem;
    background: var(--pm-accent-soft);
    color: var(--pm-accent);
    font-family: var(--pm-font-mono);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .pm-icon-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--pm-muted);
    text-decoration: none;
    font-size: 0.82rem;
    transition: color 0.12s ease;
  }
  .pm-icon-link:hover {
    color: var(--pm-text);
  }
  .pm-return-link {
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--pm-border);
    background: var(--pm-surface-raised);
    white-space: nowrap;
  }
  .pm-return-link:hover {
    border-color: var(--pm-accent);
  }

  .pm-content {
    flex: 1;
    padding: 1.5rem 0;
    width: 100%;
  }

  /* The shared site stylesheet sets h1-h4 { color: var(--secondary) } for
     its own light/dark themes - that token isn't part of this shell's
     palette, so every heading under .pm-shell rendered as a near-invisible
     dim color against the near-black background. Needs :global because
     each page's <style> is scoped to that component and can't otherwise
     reach into app.css's rule; ".pm-shell h1" outscopes the bare "h1". */
  :global(.pm-shell h1),
  :global(.pm-shell h2),
  :global(.pm-shell h3),
  :global(.pm-shell h4) {
    color: var(--pm-text);
  }

  /* Phone: event picker and Elo on one line, the sections as a swipeable tab row under them.
     The app's bottom bar already leads back home, so the back link is left to desktop. */
  @media (max-width: 900px) {
    .pm-topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2);
    }
    .pm-brand {
      display: none;
    }
    .pm-topbar-left {
      min-width: 0;
    }
    .pm-event-picker {
      display: flex;
      min-width: 0;
    }
    .pm-return-link {
      display: none;
    }
    .pm-tabs {
      grid-column: 1 / -1;
      order: 3;
      width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
      scroll-snap-type: x proximity;
    }
    .pm-tab {
      flex: none;
      min-height: var(--tap-min);
      display: inline-flex;
      align-items: center;
      scroll-snap-align: start;
    }
  }
</style>

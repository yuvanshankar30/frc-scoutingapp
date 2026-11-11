<script>
  import '../app.css';
  import '../competition.css';
  import '../calm.css';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { afterNavigate, goto } from '$app/navigation';
  import { initAuth, user, userProfile, authReady, signOut, toggleAccountTheme } from '$lib/stores/auth.js';
  import { applyTeamDefaultTheme, theme } from '$lib/stores/theme.js';
  import { setTeam, team } from '$lib/stores/team.js';
  import { brandCssVars } from '$lib/app/teamSettings.js';
  import { appearanceCssVars } from '$lib/app/appearance.js';
  import TeamMark from '$lib/components/common/TeamMark.svelte';
  import { supabaseConfigured } from '$lib/app/supabaseConfig.js';
  import { dev } from '$app/environment';
  import { activeEventKey, primeActiveEvent, refreshActiveEvent } from '$lib/stores/activeEvent.js';
  import { displayEventCode } from '$lib/scouting/eventCode.js';
  import ConfirmationDialog from '$lib/components/common/ConfirmationDialog.svelte';
  import SiteSearch from '$lib/components/common/SiteSearch.svelte';
  import { watchTables } from '$lib/ui/responsiveTables.js';
  import {
    BOTTOM_BAR_LABELS,
    activeItem,
    bottomBarItems,
    canAdministerScouting,
    isActive,
    visibleGroups
  } from '$lib/app/navigation.js';
  import {
    ArrowUpDown,
    CalendarClock,
    CalendarDays,
    ChevronDown,
    ClipboardCheck,
    ClipboardList,
    Database,
    Eye,
    Gamepad2,
    Globe,
    House,
    LayoutDashboard,
    ListChecks,
    ListTodo,
    LogOut,
    Menu,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Pencil,
    Radar,
    Search,
    Settings2,
    Sparkles,
    Sun,
    Swords,
    Target,
    Trophy,
    UserCog,
    UserPlus,
    Wrench,
    X,
    Zap
  } from 'lucide-svelte';

  const ICONS = {
    ArrowUpDown,
    CalendarClock,
    CalendarDays,
    ClipboardCheck,
    ClipboardList,
    Database,
    Eye,
    Gamepad2,
    Globe,
    House,
    LayoutDashboard,
    ListChecks,
    ListTodo,
    Pencil,
    Radar,
    Search,
    Settings2,
    Sparkles,
    Swords,
    Target,
    Trophy,
    UserCog,
    UserPlus,
    Wrench,
    Zap
  };

  // The team's settings, read on the server for every full page load (+layout.server.js).
  export let data;
  // The server could not read the team settings: no database configured yet, or the schema is missing.
  $: setupProblem =
    !supabaseConfigured || data?.settingsError ? data?.settingsError || 'Supabase is not configured' : '';
  $: setTeam(data?.team);

  // The brand color as CSS variables for both themes, in the page head so the first paint already has it.
  const cssBlock = (selector, vars) =>
    `${selector} { ${Object.entries(vars)
      .map(([name, value]) => `${name}: ${value};`)
      .join(' ')} }`;
  $: brandStyle = $team
    ? [
        cssBlock('html:root:root[data-theme="modern"]', {
          ...appearanceCssVars($team.appearance, 'modern', $team.brandColor),
          ...brandCssVars($team.brandColor, 'modern')
        }),
        cssBlock('html:root:root[data-theme="modern-dark"]', {
          ...appearanceCssVars($team.appearance, 'modern-dark', $team.brandColor),
          ...brandCssVars($team.brandColor, 'modern-dark')
        })
      ].join('\n')
    : '';
  $: appName = $team?.appName || 'Scouting';
  // The app name with its last word set in the serif accent, like the Hub's brand.
  $: brandWords = $team?.appearance?.serifAccent === false ? [appName] : String(appName).trim().split(/\s+/);
  $: brandHead = brandWords.length > 1 ? `${brandWords.slice(0, -1).join(' ')} ` : appName;
  $: brandTail = brandWords.length > 1 ? brandWords.at(-1) : '';

  const RAIL_STORAGE_KEY = 'scouting-rail-collapsed';
  let collapsed = false;
  let menuOpen = false;
  let searchOpen = false;
  // Menu groups someone folded away (kept on this device). Every group starts open.
  const CLOSED_GROUPS_KEY = 'scouting-closed-groups';
  let closedGroups = [];
  const groupHasCurrent = (group) => group.items.some((item) => item.key === current?.key);
  function toggleGroup(key) {
    closedGroups = closedGroups.includes(key) ? closedGroups.filter((k) => k !== key) : [...closedGroups, key];
    try {
      localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify(closedGroups));
    } catch {
      /* storage can be unavailable */
    }
  }
  // Ctrl on Windows and Linux, the Command key on Apple devices.
  let modKey = 'Ctrl';
  let stageEl;
  // A short fade-up on the page area whenever the route changes. Restarted by toggling
  // the class rather than re-creating the page, so nested layouts keep their state.
  let lastNavAt = 0;
  afterNavigate((navigation) => {
    // Picking a page from the phone menu closes it. (A reactive `if (menuOpen && pathname)` would also run the
    // moment the menu opened and close it straight away.)
    menuOpen = false;
    // Switching a tab that only changes the query string (?tab=...) is not a new page.
    if (navigation.from && navigation.to && navigation.from.url.pathname === navigation.to.url.pathname) return;
    lastNavAt = performance.now();
    if (!stageEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    stageEl.classList.remove('enter');
    void stageEl.offsetWidth;
    stageEl.classList.add('enter');
  });

  // Content that shows up after the page is already on screen (a table replacing its
  // "Loading..." line, a tab's panel, a card that finished fetching) drops in quickly
  // instead of popping. Only the top-most large block of each insertion is animated, so
  // rows, chips, overlays and anything marked data-no-reveal are left alone.
  const REVEAL_MIN_HEIGHT = 80;
  const isPlaceholder = (node) =>
    /loading|skeleton|spinner/i.test(String(node.className)) ||
    (node.textContent.length < 80 && /loading|\.\.\.|…/i.test(node.textContent));
  let stageObserver;
  function watchStage(el) {
    stageObserver?.disconnect();
    if (!browser || !el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    stageObserver = new MutationObserver((records) => {
      if (performance.now() - lastNavAt < 280) return;
      const added = new Set(records.flatMap((record) => [...record.addedNodes]).filter((node) => node.nodeType === 1));
      // Whatever replaces a "Loading..." line or skeleton is the content that just finished
      // loading, so it animates however small it is.
      const filledIn = new Set();
      for (const record of records) {
        const removed = [...record.removedNodes].filter((node) => node.nodeType === 1);
        if (removed.some(isPlaceholder)) filledIn.add(record.target);
      }
      for (const node of added) {
        if (node.parentElement && added.has(node.parentElement)) continue;
        if (node.closest('[data-no-reveal]') || node.tagName === 'OPTION') continue;
        const swapped = filledIn.has(node.parentElement);
        if (node.offsetHeight < (swapped ? 12 : REVEAL_MIN_HEIGHT)) continue;
        const position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'absolute') continue;
        node.classList.add('reveal-in');
        node.addEventListener('animationend', () => node.classList.remove('reveal-in'), { once: true });
      }
    });
    stageObserver.observe(el, { childList: true, subtree: true });
  }
  $: watchStage(stageEl);
  // Data tables become labelled cards on phones (CSS in app.css); desktop keeps the table.
  let stopTables = () => {};
  $: if (browser && stageEl) {
    stopTables();
    stopTables = watchTables(stageEl);
  }

  $: pathname = $page.url.pathname;
  // The page that shows no site chrome and needs no sign-in: the login form.
  $: isLogin = pathname === '/login';
  $: canAdmin = canAdministerScouting($userProfile);
  $: groups = visibleGroups(canAdmin, $team?.hiddenFeatures || []);
  // The phone bar follows the person's competition role (see bottomBarKeys).
  $: bottomItems = bottomBarItems($userProfile?.roster_keys || [], $team?.hiddenFeatures || []);
  $: current = activeItem(pathname, true);
  // Everything the search can open: Home, every page in this person's menu, and Account.
  $: searchPages = [
    { key: 'home', label: 'Home', href: '/', blurb: 'Next match, assignments and coverage', group: '' },
    ...groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))),
    { key: 'account', label: 'Account', href: '/account', blurb: 'Your name, theme and password', group: '' }
  ];
  // Pages outside the menu (Quick Scout, Note Scout, ...) are named from their address, not called Home.
  const PAGE_TITLES = {
    quickscout: 'Quick Scout',
    notescout: 'Note Scout',
    datascout: 'Data Scout',
    assistant: 'AI analytics'
  };
  $: stripTitle =
    current?.label ||
    (pathname === '/' ? 'Home' : PAGE_TITLES[pathname.split('/')[1]] || pathname.split('/')[1].replace(/-/g, ' '));
  $: displayName = $userProfile?.full_name || $user?.email || '';
  $: if (browser && $authReady && $user) void refreshActiveEvent();

  // Everything here needs a signed-in account; send anyone else to sign in and
  // bring them back to where they were headed.
  $: if (browser && $authReady && !$user && !isLogin) {
    void goto(`/login?next=${encodeURIComponent(pathname + $page.url.search)}`, { replaceState: true });
  }

  onMount(() => {
    modKey = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
    try {
      collapsed = localStorage.getItem(RAIL_STORAGE_KEY) === '1';
      const saved = JSON.parse(localStorage.getItem(CLOSED_GROUPS_KEY) || '[]');
      closedGroups = Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : [];
    } catch {
      /* storage can be unavailable */
    }
    applyTeamDefaultTheme($team?.defaultTheme);
    const stopAuth = initAuth();
    primeActiveEvent();
    // Someone else may change the event while this tab is open, so look again when it comes back into view.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && $user) void refreshActiveEvent();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopAuth?.();
      stageObserver?.disconnect();
      stopTables();
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  function toggleRail() {
    collapsed = !collapsed;
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage can be unavailable */
    }
  }

  async function handleSignOut() {
    await signOut();
    await goto('/login');
  }
</script>

<svelte:head>
  <meta name="apple-mobile-web-app-title" content={$team?.appShortName || 'Scouting'} />
  {#if brandStyle}{@html `<style>${brandStyle}</style>`}{/if}
</svelte:head>

{#if setupProblem}
  <main class="not-connected">
    <section>
      <h1>Not connected to a database yet</h1>
      <p>
        The server can't read its settings. Set <code>PUBLIC_SUPABASE_URL</code>, <code>PUBLIC_SUPABASE_ANON_KEY</code>
        and
        <code>SUPABASE_SERVICE_KEY</code> in <code>.env</code>, apply the schema in <code>supabase/migrations</code>,
        and restart the server. The README's Quick start has every step.
      </p>
      {#if dev}<p class="detail"><b>Details:</b> {setupProblem}</p>{/if}
    </section>
  </main>
{:else if isLogin}
  <slot />
{:else if !$authReady || !$user}
  <div class="boot" role="status">Loading {appName}...</div>
{:else}
  <div class="shell" class:collapsed>
    <aside class="rail" aria-label="Main navigation">
      <div class="brand-row">
        <a class="brand" href="/" title={appName}>
          <TeamMark size={34} />
          <span class="brand-text"
            >{brandHead}{#if brandTail}<span class="serif-accent">{brandTail}</span>{/if}</span
          >
        </a>
        <button
          type="button"
          class="icon-btn rail-toggle"
          on:click={toggleRail}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
        >
          {#if collapsed}<PanelLeftOpen size={17} />{:else}<PanelLeftClose size={17} />{/if}
        </button>
      </div>

      <button
        type="button"
        class="rail-search"
        on:click={() => (searchOpen = true)}
        title={collapsed ? 'Search (Ctrl K)' : undefined}
        aria-label="Search pages and teams"><Search size={16} /><span>Search</span><kbd>{modKey} K</kbd></button
      >

      <nav class="rail-nav">
        <a class="rail-home" class:active={isActive(pathname, '/')} href="/" title={collapsed ? 'Home' : undefined}
          ><House size={18} /><span>Home</span></a
        >
        {#each groups as group (group.key)}
          {@const folded = !collapsed && closedGroups.includes(group.key) && !groupHasCurrent(group)}
          <div class="rail-group" class:folded>
            <button type="button" class="rail-label" aria-expanded={!folded} on:click={() => toggleGroup(group.key)}
              ><span>{group.label}</span><ChevronDown size={13} /></button
            >
            {#each folded ? [] : group.items as item (item.key)}
              <a
                class="rail-link"
                class:active={current?.key === item.key}
                href={item.href}
                title={collapsed ? item.label : item.blurb}
                aria-label={item.label}
              >
                <svelte:component this={ICONS[item.icon]} size={18} />
                <span>{item.label}</span>
              </a>
            {/each}
          </div>
        {/each}
      </nav>

      <div class="rail-foot">
        <a
          class="who"
          class:active={pathname === '/account'}
          href="/account"
          title="Account"
          aria-label={`Account: ${displayName}`}
        >
          <span class="avatar" aria-hidden="true">{(displayName || '?').slice(0, 1).toUpperCase()}</span>
          <span class="who-name">{displayName}</span>
        </a>
        <div class="foot-actions">
          <button
            type="button"
            class="icon-btn"
            on:click={toggleAccountTheme}
            aria-label="Switch between dark and light"
            title="Dark / light"
          >
            {#if $theme === 'modern-dark'}<Sun size={17} />{:else}<Moon size={17} />{/if}
          </button>
          <button type="button" class="icon-btn" on:click={handleSignOut} aria-label="Sign out" title="Sign out"
            ><LogOut size={17} /></button
          >
        </div>
      </div>
    </aside>

    <div class="main-col">
      <header class="strip">
        <div class="strip-left">
          <button type="button" class="icon-btn menu-btn" on:click={() => (menuOpen = true)} aria-label="Open menu"
            ><Menu size={20} /></button
          >
          <span class="strip-title">{stripTitle}</span>
        </div>
        <div class="strip-right">
          {#if $activeEventKey}
            <span class="strip-event" title="Active competition code">{displayEventCode($activeEventKey)}</span>
          {/if}
          <button type="button" class="icon-btn strip-search" on:click={() => (searchOpen = true)} aria-label="Search"
            ><Search size={18} /></button
          >
        </div>
      </header>

      {#if canAdmin && !$team?.teamNumber}
        <a class="set-team" href="/scouting-admin/team"
          >Set your team number, name and colors in Scouting Admin &gt; Team settings.</a
        >
      {/if}
      <main class="stage" bind:this={stageEl}>
        <slot />
      </main>
    </div>

    <nav class="bottom-bar" aria-label="Quick navigation">
      {#each bottomItems as item (item.key)}
        {@const on = item.key === 'home' ? pathname === '/' : current?.key === item.key}
        <a class:active={on} aria-current={on ? 'page' : undefined} href={item.href}>
          <span class="bar-icon"><svelte:component this={ICONS[item.icon]} size={22} /></span>
          <span class="bar-label">{BOTTOM_BAR_LABELS[item.key] || item.label}</span>
        </a>
      {/each}
      <button type="button" class:active={menuOpen} aria-expanded={menuOpen} on:click={() => (menuOpen = true)}
        ><span class="bar-icon"><Menu size={22} /></span><span class="bar-label">More</span></button
      >
    </nav>

    {#if menuOpen}
      <div class="sheet-backdrop" role="presentation" on:click={() => (menuOpen = false)}></div>
      <div class="sheet" role="dialog" aria-label="All pages">
        <div class="sheet-head">
          <b>{appName}</b>
          <button type="button" class="icon-btn" on:click={() => (menuOpen = false)} aria-label="Close menu"
            ><X size={20} /></button
          >
        </div>
        <span class="sheet-grip" aria-hidden="true"></span>
        <a class="sheet-home" href="/"><House size={18} /> Home</a>
        {#each groups as group (group.key)}
          <p class="rail-label">{group.label}</p>
          <div class="sheet-grid">
            {#each group.items as item (item.key)}
              <a class:active={current?.key === item.key} href={item.href}>
                <svelte:component this={ICONS[item.icon]} size={20} />
                <span class="sheet-text"
                  ><b>{item.label}</b>{#if item.blurb}<small>{item.blurb}</small>{/if}</span
                >
              </a>
            {/each}
          </div>
        {/each}
        <div class="sheet-foot">
          <a class="btn btn-outline btn-sm" href="/account">Account</a>
          <button type="button" class="btn btn-outline btn-sm" on:click={toggleAccountTheme}
            >{$theme === 'modern-dark' ? 'Light mode' : 'Dark mode'}</button
          >
          <button type="button" class="btn btn-outline btn-sm" on:click={handleSignOut}>Sign out</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<ConfirmationDialog />
{#if $user && !isLogin}<SiteSearch bind:open={searchOpen} pages={searchPages} />{/if}

<style>
  .set-team {
    display: block;
    padding: var(--space-2) var(--space-4);
    background: var(--accent-subtle);
    color: var(--text);
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
    text-decoration: none;
  }
  .set-team:hover {
    text-decoration: underline;
  }
  .not-connected {
    min-height: calc(100 * var(--vh));
    display: grid;
    place-items: center;
    padding: var(--space-5);
    background: var(--background);
    color: var(--text);
  }
  .not-connected section {
    width: min(38rem, 100%);
    padding: var(--space-5);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .not-connected h1 {
    margin: 0 0 var(--space-3);
    font-size: 1.5rem;
  }
  .not-connected p {
    margin: 0;
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .not-connected .detail {
    margin-top: var(--space-3);
    font-family: var(--font-mono-stack);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .boot {
    display: grid;
    place-items: center;
    min-height: calc(100 * var(--vh));
    color: var(--text-secondary);
    font-family: var(--font-display);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .shell {
    display: grid;
    grid-template-columns: var(--rail-width) minmax(0, 1fr);
    min-height: calc(100 * var(--vh));
    background: var(--background);
    transition: grid-template-columns 0.18s ease;
  }
  .shell.collapsed {
    --rail-width: 4.5rem;
  }
  .shell.collapsed .rail {
    padding-inline: 0.6rem;
    align-items: stretch;
  }
  .shell.collapsed .brand-row {
    flex-direction: column;
    padding-inline: 0;
  }
  .shell.collapsed .brand-text,
  .shell.collapsed .rail-label,
  .shell.collapsed .rail-link span,
  .shell.collapsed .rail-home span,
  .shell.collapsed .who-name {
    display: none;
  }
  .shell.collapsed .rail-group {
    border-top: 1px solid var(--border);
    padding-top: var(--space-2);
  }
  .shell.collapsed .rail-link,
  .shell.collapsed .rail-home {
    justify-content: center;
    padding-inline: 0;
  }
  .shell.collapsed .rail-link.active::before,
  .shell.collapsed .rail-home.active::before {
    left: -0.6rem;
  }
  .shell.collapsed .who {
    justify-content: center;
  }
  .shell.collapsed .foot-actions {
    flex-direction: column;
    align-items: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .shell,
    .rail-link,
    .rail-home,
    .rail-link::before,
    .rail-home::before {
      transition: none;
    }
    .rail-link:hover,
    .rail-home:hover {
      transform: none;
    }
  }

  /* --rp is the vertical padding of a nav row: .5rem when there is room, squeezed as the window gets shorter so the whole menu
     stays on one screen without scrolling (the numbers come from the menu's measured height: 52.3rem + 57 * --rp). */
  .rail {
    --rp: clamp(0.04rem, calc((100 * var(--vh) - 53rem) / 57), 0.5rem);
    position: sticky;
    top: 0;
    height: calc(100 * var(--vh));
    display: flex;
    flex-direction: column;
    gap: calc(var(--rp) * 1.5);
    padding: var(--space-4) var(--space-3);
    background: color-mix(in srgb, var(--background) 82%, transparent);
    backdrop-filter: blur(14px) saturate(1.2);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    border-right: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    overflow: hidden;
  }
  .brand-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-1) var(--space-3) var(--space-2);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    text-decoration: none;
    color: var(--text-strong, var(--text));
  }
  .rail-toggle {
    flex-shrink: 0;
  }
  .brand-text {
    font-family: var(--font-body, var(--font-display));
    font-weight: 600;
    letter-spacing: -0.01em;
    font-size: 1.12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rail-nav {
    display: flex;
    flex-direction: column;
    gap: calc(var(--rp) * 1.5);
    flex: 1;
  }
  .rail-group {
    display: grid;
    gap: 2px;
  }
  /* A group's label folds its pages away; the chevron turns when it is folded. */
  button.rail-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.15rem var(--space-2) 0.15rem 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    text-align: left;
    cursor: pointer;
  }
  button.rail-label:hover {
    color: var(--text);
  }
  button.rail-label :global(svg) {
    opacity: 0.7;
    transition: transform 0.18s ease;
  }
  .rail-group.folded button.rail-label :global(svg) {
    transform: rotate(-90deg);
  }
  .rail-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 2.25rem;
    padding: 0 var(--space-3);
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.88rem;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      color 0.15s ease;
  }
  .rail-search:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .rail-search span {
    flex: 1;
    text-align: left;
  }
  .rail-search kbd {
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    font-family: inherit;
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .shell.collapsed .rail-search {
    justify-content: center;
    padding: 0;
  }
  .shell.collapsed .rail-search span,
  .shell.collapsed .rail-search kbd {
    display: none;
  }
  .strip-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .strip .strip-search {
    display: none;
  }
  .rail-label {
    margin: 0 0 var(--space-1) var(--space-3);
    font-family: var(--font-body, var(--font-display));
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .rail-link,
  .rail-home {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--rp) var(--space-3);
    border-radius: var(--radius-full);
    color: var(--text-secondary);
    text-decoration: none;
    font-weight: 500;
    font-size: 0.92rem;
  }
  .rail-home {
    font-size: 0.95rem;
    color: var(--text);
  }
  .rail-link,
  .rail-home {
    transition:
      background-color 0.18s ease,
      color 0.18s ease,
      transform 0.18s ease;
  }
  .rail-link:hover,
  .rail-home:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
    color: var(--text-strong, var(--text));
  }
  .rail-link.active,
  .rail-home.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-strong, var(--text));
  }
  .rail-link.active :global(svg),
  .rail-home.active :global(svg) {
    color: var(--accent);
  }
  .rail-link::before,
  .rail-home::before {
    content: '';
    position: absolute;
    left: -0.75rem;
    top: 0.3rem;
    bottom: 0.3rem;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
    transform: scaleY(0);
    transition: transform 0.2s ease;
  }
  .rail-link.active::before,
  .rail-home.active::before {
    transform: scaleY(1);
  }
  .rail-foot {
    display: grid;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  /* The rail never scrolls, so on shorter windows it tightens instead until every link fits. */
  @media (min-width: 901px) and (max-height: 62rem) {
    .rail {
      padding-block: var(--space-2);
    }
    .brand-row {
      padding-bottom: var(--space-2);
    }
    .rail-link,
    .rail-home {
      line-height: 1.15;
      font-size: 0.88rem;
    }
    .rail-label {
      margin-bottom: 0;
      font-size: 0.66rem;
    }
    .rail-foot {
      gap: var(--space-1);
      padding-top: var(--space-2);
    }
  }
  @media (min-width: 901px) and (max-height: 50rem) {
    .rail-label {
      display: none;
    }
    .rail-group + .rail-group {
      border-top: 1px solid var(--border);
      padding-top: 2px;
    }
    .rail-link,
    .rail-home {
      font-size: 0.84rem;
    }
  }
  .who {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
  }
  .who:hover,
  .who.active {
    background: var(--surface-2);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-contrast);
    font-weight: 700;
    flex-shrink: 0;
  }
  .who-name {
    font-size: 0.85rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .foot-actions {
    display: flex;
    gap: var(--space-2);
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 2.1rem;
    height: 2.1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .foot-actions {
    flex-wrap: wrap;
  }
  .main-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .strip {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: var(--strip-height);
    padding: 0 var(--space-5);
    background: color-mix(in srgb, var(--background) 82%, transparent);
    backdrop-filter: blur(14px) saturate(1.2);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .strip-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .strip-title {
    font-family: var(--font-body, var(--font-display));
    font-size: 1.2rem;
    font-weight: 500;
    letter-spacing: -0.02em;
    color: var(--text-strong, var(--text));
  }
  .strip-event {
    flex: 0 0 auto;
    margin-left: var(--space-3);
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    font-size: 0.8rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .menu-btn {
    display: none;
  }
  .stage {
    padding: var(--space-5);
    min-width: 0;
  }
  .stage:global(.enter) {
    animation: stage-in 0.26s ease backwards;
  }
  :global(.reveal-in) {
    animation: reveal-drop 0.22s ease-out;
  }
  @keyframes reveal-drop {
    from {
      opacity: 0;
      transform: translateY(-12px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes stage-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .bottom-bar,
  .sheet,
  .sheet-backdrop {
    display: none;
  }

  @media (max-width: 900px) {
    .shell {
      grid-template-columns: minmax(0, 1fr);
    }
    .rail {
      display: none;
    }
    .strip .strip-search {
      display: inline-grid;
      width: var(--tap-min);
      height: var(--tap-min);
      border: 0;
    }
    /* No menu button on phones: "More" in the bottom bar opens the same menu. */
    .menu-btn {
      display: none;
    }
    .strip-left {
      padding-left: calc(var(--page-gutter) - var(--space-2));
    }
    /* The top strip clears the notch / status bar when the app runs full screen from the home screen. */
    .strip {
      min-height: calc(3rem + var(--safe-top));
      padding: var(--safe-top) calc(var(--page-gutter) + var(--safe-right)) 0 calc(var(--space-2) + var(--safe-left));
    }
    .strip-left {
      min-width: 0;
    }
    .strip-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .strip-title {
      font-size: 1.05rem;
    }
    .strip-event {
      font-size: 0.95rem;
      margin-left: var(--space-2);
    }
    /* One gutter for every page, and room underneath for the bottom bar and its safe area. */
    .stage {
      padding: var(--space-3) calc(var(--page-gutter) + var(--safe-right)) calc(var(--dock-height) + var(--space-5))
        calc(var(--page-gutter) + var(--safe-left));
    }
    .bottom-bar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      min-height: var(--bar-height);
      padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
      background: color-mix(in srgb, var(--surface-1) 94%, transparent);
      backdrop-filter: blur(10px);
      border-top: 1px solid var(--border);
    }
    .bottom-bar a,
    .bottom-bar button {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      min-height: var(--bar-height);
      padding: 0.35rem 0.15rem;
      background: none;
      border: 0;
      color: var(--text-secondary);
      text-decoration: none;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .bar-icon {
      display: grid;
      place-items: center;
      width: 3.4rem;
      height: 1.9rem;
      border-radius: 999px;
      transition:
        background-color 0.15s ease,
        color 0.15s ease;
    }
    .bar-label {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .bottom-bar a.active,
    .bottom-bar button.active {
      color: var(--accent-strong);
    }
    .bottom-bar a.active .bar-icon,
    .bottom-bar button.active .bar-icon {
      background: var(--accent-subtle);
    }
    .bottom-bar a:active .bar-icon,
    .bottom-bar button:active .bar-icon {
      transform: scale(0.94);
    }
    .sheet-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 30;
      background: var(--modal-overlay);
    }
    .sheet {
      display: grid;
      align-content: start;
      gap: var(--space-2);
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 31;
      max-height: calc(88 * var(--vh));
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: var(--space-2) calc(var(--space-4) + var(--safe-right)) calc(var(--space-4) + var(--safe-bottom))
        calc(var(--space-4) + var(--safe-left));
      background: var(--surface-1);
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      border-top: 1px solid var(--border);
      animation: sheet-up 0.2s ease-out;
    }
    @keyframes sheet-up {
      from {
        transform: translateY(16px);
        opacity: 0.6;
      }
      to {
        transform: none;
        opacity: 1;
      }
    }
    .sheet-grip {
      justify-self: center;
      width: 2.5rem;
      height: 4px;
      border-radius: 999px;
      background: var(--border);
      order: -1;
    }
    .sheet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: var(--font-display);
      letter-spacing: 0.14em;
    }
    .sheet-head .icon-btn {
      width: var(--tap-min);
      height: var(--tap-min);
    }
    .sheet .rail-label {
      margin: var(--space-3) 0 0 var(--space-1);
    }
    .sheet-home {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--tap-comfort);
      padding: 0 var(--space-3);
      border-radius: var(--radius-sm);
      background: var(--surface-2);
      color: var(--text);
      text-decoration: none;
      font-family: var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .sheet-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .sheet-grid a {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      min-height: 3.5rem;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      text-decoration: none;
    }
    .sheet-grid a :global(svg) {
      flex: none;
      margin-top: 2px;
      color: var(--text-secondary);
    }
    .sheet-text {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .sheet-text b {
      font-size: 0.92rem;
      font-weight: 600;
    }
    .sheet-text small {
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.25;
    }
    .sheet-grid a.active {
      border-color: var(--accent);
      background: var(--accent-subtle);
    }
    .sheet-grid a.active :global(svg) {
      color: var(--accent-strong);
    }
    .sheet-foot {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      padding-top: var(--space-3);
    }
    .sheet-foot > * {
      flex: 1 1 auto;
      min-height: var(--tap-min);
    }
  }
  @media (max-width: 380px) {
    .sheet-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }

  /* Phone: wrap, never cut text. On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .who-name,
    .strip-title {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

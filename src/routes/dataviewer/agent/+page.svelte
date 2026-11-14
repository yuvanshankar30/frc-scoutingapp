<script>
  // Data Viewer > Agent: a chat with the analysis agent (Gemini), laid out like AI analytics (/assistant): recent chats
  // on the left, the conversation in the middle, the question box docked at the bottom. It reads our scouting and
  // outside sources (TBA, FIRST FRC Events, Match13, Statbotics) and lists where each answer came from.
  // Switched off for now (ANALYSIS_AGENT_ENABLED): the tab shows, but the page says the agent isn't on yet and the
  // question box and suggestions are disabled.
  import { onMount, tick } from 'svelte';
  import { ArrowUp, Check, Copy, PanelLeftClose, PanelLeftOpen, SquarePen, Sparkles, Trash2 } from 'lucide-svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { isPhone } from '$lib/stores/device.js';
  import { user } from '$lib/stores/auth.js';
  import { ago, deleteChat, listChats, loadChat, newChatId, saveChat } from '$lib/assistant/chatStore.js';
  import { renderMarkdown } from '$lib/app/miniMarkdown.js';
  import { useDataViewer } from '$lib/components/dataViewer/state.js';
  import {
    AGENT_SOURCES,
    ANALYSIS_AGENT_ENABLED,
    MAX_QUESTION_CHARS,
    conversationForApi
  } from '$lib/scouting/analysisAgent.js';

  const { eventKey } = useDataViewer();
  const SOURCE_LABELS = Object.fromEntries(AGENT_SOURCES.map((source) => [source.key, source.label]));
  const SUGGESTIONS = [
    { title: 'Who is improving', text: 'Which teams improved the most at scoring over the event, and by how much?' },
    { title: 'Ours vs official', text: 'How do our scouted balls scored compare with the official rankings from TBA?' },
    { title: 'Next match', text: 'What does Match13 forecast for our next match, and what does our scouting say?' },
    { title: 'A team in full', text: 'Give me everything we scouted about team 254, match and pit.' }
  ];

  let status = null; // { enabled, configured, sources } from the server
  let messages = []; // { role: 'user' | 'assistant', content, sources?: [] }
  let draft = '';
  let busy = false;
  let error = '';
  let copied = -1;
  let scroller;
  let box;
  let endEl;

  $: ready = ANALYSIS_AGENT_ENABLED && Boolean(status?.configured);
  $: disabled = !ready || !$eventKey;

  // ---- saved chats: kept in this browser per signed-in person (chatStore.js), apart from AI analytics' chats. The
  // "agent:" scope keeps them under the same storage prefix, so signing out clears them too.
  const SIDEBAR_KEY = 'dataviewer-agent-sidebar-open';
  let sidebarOpen = true;
  let chatId = newChatId();
  let saved = [];
  const storage = () => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  };
  $: scope = $user?.id ? `agent:${$user.id}` : null;
  $: if (scope) saved = listChats(storage(), scope);

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0');
    } catch {
      /* storage unavailable: the choice just is not remembered */
    }
  }
  function persist() {
    if (!scope) return;
    saveChat(storage(), scope, { id: chatId, messages, eventKey: $eventKey });
    saved = listChats(storage(), scope);
  }
  function openChat(id) {
    const chat = scope ? loadChat(storage(), scope, id) : null;
    if (!chat) return;
    chatId = chat.id;
    messages = chat.messages;
    error = '';
    toBottom(true);
  }
  function removeChat(id, event) {
    event.stopPropagation();
    if (!scope) return;
    deleteChat(storage(), scope, id);
    saved = listChats(storage(), scope);
    if (id === chatId) newChat();
  }
  function newChat() {
    chatId = newChatId();
    messages = [];
    error = '';
    draft = '';
    tick().then(() => {
      grow();
      box?.focus();
    });
  }

  onMount(async () => {
    try {
      sidebarOpen = localStorage.getItem(SIDEBAR_KEY) !== '0';
    } catch {
      sidebarOpen = true;
    }
    if (!ANALYSIS_AGENT_ENABLED) return;
    const response = await authFetch('/api/dataviewer-agent').catch(() => null);
    const payload = await response?.json().catch(() => null);
    status = payload?.success ? payload.data : { enabled: false, configured: false, sources: {} };
  });

  // Long answers scroll to their start, so the person reads from the top; short ones scroll to the end.
  const calm = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  async function toBottom(instant = false) {
    await tick();
    const behavior = instant ? 'auto' : calm();
    const answers = scroller?.querySelectorAll('.row.assistant');
    const last = answers?.[answers.length - 1];
    if (!instant && last && !busy && last.offsetHeight > scroller.clientHeight * 0.6)
      last.scrollIntoView({ behavior, block: 'start' });
    else endEl?.scrollIntoView({ behavior, block: 'end' });
  }
  const grow = () => {
    if (box) {
      box.style.height = 'auto';
      box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
    }
  };

  async function ask(text) {
    const question = (text ?? draft).trim().slice(0, MAX_QUESTION_CHARS);
    if (!question || busy || disabled) return;
    draft = '';
    error = '';
    messages = [...messages, { role: 'user', content: question }];
    busy = true;
    await tick();
    grow();
    toBottom();
    try {
      const response = await authFetch('/api/dataviewer-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event_key: $eventKey, messages: conversationForApi(messages) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'The agent could not answer that.');
      messages = [
        ...messages,
        { role: 'assistant', content: payload.data.answer, sources: payload.data.sources || [] }
      ];
      persist();
    } catch (cause) {
      error = cause?.message || 'The agent could not answer that.';
    } finally {
      busy = false;
      toBottom();
    }
  }

  async function copy(index) {
    try {
      await navigator.clipboard.writeText(messages[index].content);
      copied = index;
      setTimeout(() => {
        if (copied === index) copied = -1;
      }, 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  const onKey = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask();
    }
  };
  // "Our scouting · The Blue Alliance": each source once, a failed one marked.
  const sourceLine = (sources) =>
    [...new Map((sources || []).map((s) => [s.source, s])).values()]
      .map((s) => `${SOURCE_LABELS[s.source] || s.source}${s.ok === false ? ' (failed)' : ''}`)
      .join(' · ');
</script>

<svelte:head><title>Agent · Data Viewer</title></svelte:head>

<div class="shell" class:collapsed={!sidebarOpen} class:phone={$isPhone}>
  <aside class="history" aria-label="Chat history" aria-hidden={!sidebarOpen}>
    <div class="h-inner">
      <div class="h-top">
        <button class="new wide" type="button" on:click={newChat} disabled={!messages.length && !draft}
          ><SquarePen size={16} /> New chat</button
        >
      </div>
      <div class="h-title">Recent chats</div>
      <ul class="h-list">
        {#each saved as c (c.id)}
          <li>
            <div
              class="h-item"
              class:current={c.id === chatId}
              role="button"
              tabindex="0"
              on:click={() => openChat(c.id)}
              on:keydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openChat(c.id);
                }
              }}
            >
              <span class="name">{c.title}</span>
              <span class="when">{ago(c.updatedAt)}</span>
              <button
                type="button"
                class="del"
                aria-label={`Delete chat ${c.title}`}
                title="Delete chat"
                on:click={(e) => removeChat(c.id, e)}><Trash2 size={14} /></button
              >
            </div>
          </li>
        {:else}
          <li class="none">Your chats will appear here.</li>
        {/each}
      </ul>
    </div>
  </aside>

  <div class="chat-page">
    {#if $isPhone}
      <!-- Phones: the event is already in the picker above, so just the agent's state and a New chat button. -->
      <header class="phone-top">
        <span class="status" class:off={!ready}>
          <span class="dot" aria-hidden="true"></span>{ready ? 'Analysis agent' : 'Agent not turned on yet'}
        </span>
        {#if messages.length || draft}
          <button class="new-icon" type="button" on:click={newChat} aria-label="New chat" title="New chat"
            ><SquarePen size={18} /></button
          >
        {/if}
      </header>
    {:else}
      <header class="top">
        <button
          class="icon-btn open-side"
          type="button"
          on:click={toggleSidebar}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Show sidebar'}
          aria-expanded={sidebarOpen}
          title={sidebarOpen ? 'Collapse sidebar' : 'Show sidebar'}
          >{#if sidebarOpen}<PanelLeftClose size={18} />{:else}<PanelLeftOpen size={18} />{/if}</button
        >
        <span class="event">{$eventKey ? `Event ${$eventKey}` : 'no active event'}</span>
        <div class="actions">
          <button
            class="new"
            type="button"
            on:click={newChat}
            disabled={!messages.length && !draft}
            title="Start a new chat"><SquarePen size={16} /> New chat</button
          >
        </div>
      </header>
    {/if}

    {#if !ready && !$isPhone}
      <div class="notice">The analysis agent isn't turned on yet.</div>
    {/if}

    <div class="scroll" bind:this={scroller} aria-live="polite">
      {#if !messages.length}
        <div class="welcome">
          <div class="mark"><Sparkles size={22} /></div>
          <h1>Ask the analysis agent</h1>
          {#if $isPhone}
            <p>Any team, match or trend. Every number says where it came from.</p>
            <div class="chips">
              {#each SUGGESTIONS as s (s.title)}
                <button type="button" class="chip" {disabled} on:click={() => ask(s.text)}>{s.title}</button>
              {/each}
            </div>
          {:else}
            <p>
              Ask about any team, match or trend at {$eventKey || 'the active event'}. It reads our scouting and
              official sources, says where each number came from, and can't change anything.
            </p>
            <div class="suggestions">
              {#each SUGGESTIONS as s (s.title)}
                <button type="button" class="suggestion" {disabled} on:click={() => ask(s.text)}>
                  <b>{s.title}</b><span>{s.text}</span>
                </button>
              {/each}
            </div>
          {/if}
          <p class="reads">Reads: {AGENT_SOURCES.map((source) => source.label).join(' · ')}</p>
        </div>
      {:else}
        <div class="thread">
          {#each messages as m, i (i)}
            {#if m.role === 'user'}
              <div class="row user"><div class="user-bubble">{m.content}</div></div>
            {:else}
              <div class="row assistant">
                <div class="avatar"><Sparkles size={15} /></div>
                <div class="body">
                  <!-- renderMarkdown escapes HTML first, then adds only its own tags. -->
                  <div class="md" class:fresh={i === messages.length - 1}>{@html renderMarkdown(m.content)}</div>
                  <div class="meta">
                    {#if m.sources?.length}<span class="muted">{sourceLine(m.sources)}</span>{/if}
                    <button type="button" class="icon" on:click={() => copy(i)} title="Copy answer"
                      >{#if copied === i}<Check size={14} />{:else}<Copy size={14} />{/if}</button
                    >
                  </div>
                </div>
              </div>
            {/if}
          {/each}
          {#if busy}
            <div class="row assistant">
              <div class="avatar"><Sparkles size={15} /></div>
              <div class="body"><span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span></div>
            </div>
          {/if}
          {#if error}<div class="row assistant">
              <div class="avatar err">!</div>
              <div class="body error">{error}</div>
            </div>{/if}
        </div>
      {/if}
      <div class="end" bind:this={endEl} aria-hidden="true"></div>
    </div>

    <div class="dock">
      <form class="composer" on:submit|preventDefault={() => ask()}>
        <textarea
          bind:this={box}
          bind:value={draft}
          on:input={grow}
          on:keydown={onKey}
          rows="1"
          maxlength={MAX_QUESTION_CHARS}
          {disabled}
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          placeholder={ready ? 'Ask about a team, a match or a trend' : 'Not available yet'}
          aria-label="Message"
        ></textarea>
        <button class="send" type="submit" disabled={busy || !draft.trim() || disabled} aria-label="Send"
          ><ArrowUp size={18} /></button
        >
      </form>
      <small class="foot"
        >{#if $isPhone}AI can be wrong; check before you act on it.{:else}AI can be wrong. Numbers come from our
          scouting and the sources listed under each answer; check anything you will act on.{/if}</small
      >
    </div>
  </div>
</div>

<style>
  .chat-page {
    --chat-fill: color-mix(in srgb, currentColor 8%, transparent);
    --chat-hover: color-mix(in srgb, currentColor 13%, transparent);
    --chat-line: color-mix(in srgb, currentColor 22%, transparent);
    --chat-dim: color-mix(in srgb, currentColor 62%, transparent);
    --col: 56rem;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: none;
    font-size: 0.86rem;
    min-width: 0;
    margin: 0;
    height: 100%;
    min-height: 0;
  }
  /* The page fills exactly the space under the app bar (inside the stage's padding),
  so the browser window never
     scrolls: only the conversation,
  and the chat list when it is long,
  scroll inside it. */
  .shell {
    --pad-y: calc(2 * var(--space-5));
    height: clamp(28rem, calc(calc(100 * var(--vh)) - var(--strip-height, 3.25rem) - 15rem), 60rem);
    overflow: hidden;
    grid-template-rows: minmax(0, 1fr);
    font-size: 0.86rem;
    display: grid;
    grid-template-columns: 184px minmax(0, 1fr);
    column-gap: var(--space-4);
    transition:
      grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      column-gap 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .history {
    transition:
      opacity 0.25s ease 0.08s,
      visibility 0s;
    min-width: 0;
    overflow: hidden;
    height: 100%;
    padding: var(--space-3) 0;
    border-right: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  }
  .new.wide {
    justify-content: flex-start;
    flex: 1;
    padding-left: 0.65rem;
  }
  .h-top {
    display: flex;
    gap: 0.4rem;
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    background: transparent;
    border: 1px solid var(--chat-line);
    color: inherit;
    border-radius: 0.6rem;
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--chat-hover);
  }
  .open-side {
    display: none;
  }
  .shell.collapsed {
    grid-template-columns: 0px minmax(0, 1fr);
    column-gap: 0;
  }
  .shell.collapsed .history {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    border-right-color: transparent;
    transition:
      opacity 0.18s ease,
      visibility 0s 0.3s;
  }
  /* the contents keep their full width while the track shrinks,
  so text does not rewrap mid-animation */
  .h-inner {
    width: 184px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    box-sizing: border-box;
    padding-right: var(--space-3);
  }
  @media (min-width: 821px) {
    .open-side {
      display: inline-grid;
    }
  }
  .h-title {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: color-mix(in srgb, currentColor 55%, transparent);
    margin-top: 0.6rem;
    padding: 0 0.65rem;
  }
  .h-list .none {
    text-align: left;
    padding: 0.4rem 0.65rem;
  }
  .h-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
    overscroll-behavior: contain;
    display: grid;
    gap: 3px;
    align-content: start;
  }
  .h-item {
    position: relative;
    display: grid;
    gap: 0.1rem;
    padding: 0.5rem 2rem 0.5rem 0.65rem;
    border-radius: 0.6rem;
    cursor: pointer;
  }
  .h-item:hover,
  .h-item:focus-visible {
    background: color-mix(in srgb, currentColor 11%, transparent);
    outline: 0;
    box-shadow: none;
  }
  .h-item.current {
    background: color-mix(in srgb, currentColor 16%, transparent);
  }
  .h-item .del {
    opacity: 0;
  }
  .h-item:hover .del,
  .h-item:focus-within .del {
    opacity: 1;
  }
  @media (max-width: 900px) {
    .shell {
      --pad-y: calc(var(--space-3) + 5.5rem);
    }
  }
  @media (max-width: 820px) {
    .shell,
    .shell.collapsed {
      grid-template-columns: minmax(0, 1fr);
      column-gap: 0;
    }
    .history {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .shell,
    .history {
      transition: none;
    }
  }
  /* stays under the app's top bar while the thread scrolls,
  on a solid background so text never shows through it */
  .top {
    flex: none;
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--chat-line);
    background: var(--background, Canvas);
  }
  .event {
    color: var(--chat-dim);
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .actions {
    margin-left: auto;
    display: flex;
    gap: 0.5rem;
  }
  @media (min-width: 821px) {
    .shell:not(.collapsed) .actions > .new:last-child {
      display: none;
    }
  }
  .new {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    border: 1px solid var(--chat-line);
    color: inherit;
    border-radius: 0.6rem;
    padding: 0.35rem 0.7rem;
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .new:hover:not(:disabled) {
    background: var(--chat-hover);
  }
  .new:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .name {
    font-size: 0.8rem;
    font-weight: 500;
    line-height: 1.35;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }
  .when {
    font-size: 0.7rem;
    line-height: 1.2;
    color: var(--chat-dim);
  }
  .h-item {
    padding: 0.5rem 0.65rem;
    gap: 0.2rem;
  }
  /* the action buttons float over the end of the first line only while hovered,
  so titles get the full width */
  .h-item .del {
    background: var(--background, Canvas);
    border: 1px solid var(--chat-line);
  }
  .del {
    position: absolute;
    right: 0.4rem;
    top: 0.35rem;
    background: transparent;
    border: 0;
    color: var(--chat-dim);
    border-radius: 0.4rem;
    padding: 0.3rem;
    cursor: pointer;
    opacity: 0;
    display: inline-grid;
  }
  .del:focus-visible {
    opacity: 1;
  }
  .del:hover {
    color: var(--danger, #e24b4b);
    background: var(--chat-fill);
  }
  .none {
    padding: 0.9rem;
    color: var(--chat-dim);
    font-size: 0.85rem;
    text-align: center;
  }
  .notice {
    width: min(100%, var(--col));
    align-self: center;
    box-sizing: border-box;
    margin-top: var(--space-3);
    margin-bottom: var(--space-2);
    padding: 0.7rem 0.9rem;
    border-radius: 0.6rem;
    border: 1px solid var(--warning, #e0a030);
    font-size: 0.9rem;
  }

  .scroll {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-4) 0.9rem var(--space-3) 0;
    margin-right: -0.9rem;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
  }
  /* sits in the middle of the free space between the top bar and the composer instead of hugging the top */
  .welcome {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: var(--space-2);
    width: min(100%, var(--col));
    margin: auto;
    padding-bottom: var(--space-5);
  }
  .mark {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--chat-fill);
    border: 1px solid var(--chat-line);
  }
  .welcome h1 {
    margin: 0;
    font-size: 1.45rem;
  }
  .welcome p {
    margin: 0;
    max-width: 40em;
    font-size: 0.85rem;
    color: var(--chat-dim);
  }
  .suggestions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    width: 100%;
    margin-top: var(--space-3);
  }
  .suggestion {
    display: grid;
    align-content: start;
    gap: 0.2rem;
    text-align: left;
    background: transparent;
    color: inherit;
    font: inherit;
    border: 1px solid var(--chat-line);
    border-radius: 0.85rem;
    padding: 0.55rem 0.75rem;
    cursor: pointer;
  }
  .suggestion b {
    font-size: 0.8rem;
  }
  .suggestion span {
    color: var(--chat-dim);
    font-size: 0.78rem;
  }
  .suggestion:hover:not(:disabled) {
    background: var(--chat-hover);
  }
  .suggestion:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .thread {
    display: grid;
    gap: var(--space-4);
    width: min(100%, var(--col));
    margin-inline: auto;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    animation: rise 0.28s ease-out both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  /* the newest answer's blocks fade in one after another,
  like it is being written */
  .md.fresh > :global(*) {
    animation: write 0.45s ease-out both;
  }
  .md.fresh > :global(*:nth-child(2)) {
    animation-delay: 0.08s;
  }
  .md.fresh > :global(*:nth-child(3)) {
    animation-delay: 0.16s;
  }
  .md.fresh > :global(*:nth-child(4)) {
    animation-delay: 0.24s;
  }
  .md.fresh > :global(*:nth-child(5)) {
    animation-delay: 0.32s;
  }
  .md.fresh > :global(*:nth-child(n + 6)) {
    animation-delay: 0.4s;
  }
  .md.fresh :global(li) {
    animation: write 0.45s ease-out both;
  }
  .md.fresh :global(li:nth-child(2)) {
    animation-delay: 0.1s;
  }
  .md.fresh :global(li:nth-child(3)) {
    animation-delay: 0.2s;
  }
  .md.fresh :global(li:nth-child(4)) {
    animation-delay: 0.3s;
  }
  .md.fresh :global(li:nth-child(n + 5)) {
    animation-delay: 0.4s;
  }
  @keyframes write {
    from {
      opacity: 0;
      transform: translateY(5px);
      filter: blur(2px);
    }
    to {
      opacity: 1;
      transform: none;
      filter: none;
    }
  }
  .suggestion {
    transition:
      transform 0.15s ease,
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .suggestion:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: var(--brand-gold-base, #c9a64e);
  }
  .welcome > * {
    animation: rise 0.5s ease-out both;
  }
  .welcome > :nth-child(2) {
    animation-delay: 0.06s;
  }
  .welcome > :nth-child(3) {
    animation-delay: 0.12s;
  }
  .welcome > :nth-child(4) {
    animation-delay: 0.2s;
  }
  .row.user {
    justify-content: flex-end;
  }
  .user-bubble {
    max-width: 75%;
    padding: 0.6rem 1rem;
    border-radius: 1.2rem;
    background: var(--chat-fill);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .avatar {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--chat-fill);
    border: 1px solid var(--chat-line);
    margin-top: 2px;
  }
  .avatar.err {
    color: var(--danger, #e24b4b);
    border-color: var(--danger, #e24b4b);
  }
  .body {
    min-width: 0;
    flex: 1;
  }
  .md :global(p) {
    margin: 0 0 0.55rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .md :global(p:last-child) {
    margin-bottom: 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 0.7rem;
    padding-left: 1.4rem;
    line-height: 1.6;
  }
  .md :global(h2),
  .md :global(h3),
  .md :global(h4),
  .md :global(h5) {
    margin: 1rem 0 0.4rem;
    line-height: 1.3;
  }
  .md :global(h2) {
    font-size: 1.25rem;
  }
  .md :global(h3) {
    font-size: 1.1rem;
  }
  .md :global(h4),
  .md :global(h5) {
    font-size: 1rem;
  }
  .md :global(hr) {
    border: 0;
    border-top: 1px solid var(--chat-line);
    margin: 1rem 0;
  }
  .md :global(blockquote) {
    margin: 0 0 0.7rem;
    padding: 0.2rem 0.9rem;
    border-left: 3px solid var(--brand-gold-base, #c9a64e);
    color: var(--chat-dim);
  }
  .md :global(a) {
    color: var(--brand-gold-base, #c9a64e);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .md :global(pre) {
    margin: 0 0 0.8rem;
    padding: 0.8rem 1rem;
    overflow-x: auto;
    border-radius: 0.7rem;
    background: var(--chat-fill);
    border: 1px solid var(--chat-line);
  }
  .md :global(pre code) {
    background: transparent;
    padding: 0;
    font-size: 0.85rem;
  }
  .md :global(.table-wrap) {
    overflow-x: auto;
    margin: 0 0 0.8rem;
    border: 1px solid var(--chat-line);
    border-radius: 0.7rem;
  }
  .md :global(table) {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
  }
  .md :global(th),
  .md :global(td) {
    padding: 0.45rem 0.8rem;
    text-align: left;
    border-bottom: 1px solid var(--chat-line);
    white-space: nowrap;
  }
  .md :global(th) {
    background: var(--chat-fill);
    font-weight: 600;
  }
  .md :global(tbody tr:last-child td) {
    border-bottom: 0;
  }
  .md :global(.katex-display) {
    margin: 0.6rem 0;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .md :global(.katex) {
    font-size: 1.05em;
  }
  .md :global(del) {
    color: var(--chat-dim);
  }
  .md :global(li > ul),
  .md :global(li > ol) {
    margin: 0.25rem 0 0;
  }
  .md :global(code) {
    background: var(--chat-fill);
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    font-size: 0.88em;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.35rem;
    font-size: 0.78rem;
  }
  .muted {
    color: var(--chat-dim);
  }
  .icon {
    background: transparent;
    border: 0;
    color: var(--chat-dim);
    cursor: pointer;
    padding: 0.2rem;
    border-radius: 0.4rem;
    display: inline-grid;
  }
  .icon:hover {
    color: inherit;
    background: var(--chat-hover);
  }
  .error {
    color: var(--danger, #e24b4b);
  }
  .dots {
    display: inline-flex;
    gap: 5px;
    padding: 0.6rem 0;
  }
  .dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--chat-dim);
    animation: pulse 1.2s infinite ease-in-out;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes pulse {
    0%,
    80%,
    100% {
      opacity: 0.25;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots i {
      animation: none;
      opacity: 0.6;
    }
    .row,
    .welcome > *,
    .md.fresh > :global(*),
    .md.fresh :global(li) {
      animation: none;
    }
    .suggestion {
      transition: none;
    }
  }

  .end {
    height: 1px;
    flex: none;
  }
  .row.assistant {
    scroll-margin-top: 12px;
  }
  .dock {
    flex: none;
    width: min(100%, var(--col));
    align-self: center;
    padding: var(--space-2) 0 0;
    display: grid;
    gap: 0.5rem;
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    border: 1px solid var(--chat-line);
    border-radius: 1.5rem;
    padding: 0.35rem 0.4rem 0.35rem 0.9rem;
    background: var(--chat-fill);
  }
  .composer:focus-within {
    border-color: var(--brand-gold-base, #c9a64e);
  }
  textarea,
  textarea:focus,
  textarea:focus-visible {
    box-shadow: none;
    outline: 0;
    border: 0;
  }
  /* the app's global textarea rule asks for 2.5 controls of height,
  which made one line look like a form box */
  textarea {
    flex: 1;
    min-height: 0;
    resize: none;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: 1.45;
    padding: 0.3rem 0;
    max-height: 180px;
    font-size: 0.88rem;
  }
  textarea::placeholder {
    color: var(--chat-dim);
  }
  .send {
    flex: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 0;
    display: grid;
    place-items: center;
    cursor: pointer;
    background: var(--brand-gold-base, #c9a64e);
    color: #111;
  }
  .send:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .foot {
    text-align: center;
    color: var(--chat-dim);
    font-size: 0.7rem;
  }

  @media (max-width: 1250px) {
    .suggestions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (max-width: 600px) {
    .suggestions {
      grid-template-columns: 1fr;
    }
    .user-bubble {
      max-width: 92%;
    }
  }

  /* Phone: wrap,
  never cut text (#124). On phones these lines wrap instead of ending in "...". */
  /* The sources the agent reads,
  under the suggestions. */
  .reads {
    margin: var(--space-3) 0 0;
    color: var(--chat-dim);
    font-size: 0.8rem;
    text-align: center;
  }

  /* Phones: a compact screen of its own. */
  .phone-top {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--tap-min);
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border-radius: var(--radius-full);
    background: var(--chat-fill);
    color: var(--chat-dim);
    font-size: max(var(--text-min), 0.8rem);
  }
  .status .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--success, #2fa36b);
  }
  .status.off .dot {
    background: var(--warning, #e0a030);
  }
  .new-icon {
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--chat-line);
    border-radius: var(--radius-full);
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .phone .welcome h1 {
    font-size: 1.3rem;
  }
  .phone .welcome p {
    font-size: 0.9rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .chip {
    min-height: var(--tap-min);
    padding: 0 var(--space-4);
    border: 1px solid var(--chat-line);
    border-radius: var(--radius-full);
    background: var(--chat-fill);
    color: inherit;
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .phone .reads {
    font-size: max(var(--text-min), 0.75rem);
  }
  /* The conversation scrolls with the page and the question box stays docked just above the app's bottom bar. */
  .shell.phone {
    height: auto;
    min-height: 0;
    overflow: visible;
  }
  .phone .chat-page {
    height: auto;
  }
  .phone .scroll {
    flex: none;
    overflow: visible;
    margin-right: 0;
    padding: var(--space-4) 0 var(--space-3);
  }
  .phone .welcome {
    min-height: 0;
    padding: var(--space-5, 1.5rem) 0 var(--space-3);
  }
  .phone .dock {
    position: sticky;
    bottom: calc(var(--dock-height, 4.5rem) + var(--space-2));
    z-index: 5;
    padding-top: var(--space-2);
    background: var(--background, Canvas);
  }
  .phone .composer textarea {
    font-size: 16px;
  }
  .phone .send {
    width: var(--tap-min);
    height: var(--tap-min);
  }
</style>

<script>
  import { onMount, tick } from 'svelte';
  import {
    ArrowUp,
    Check,
    ChevronDown,
    Copy,
    Download,
    FileSpreadsheet,
    X,
    FolderOpen,
    Pencil,
    PanelLeftClose,
    PanelLeftOpen,
    Search,
    SquarePen,
    Sparkles,
    Trash2
  } from 'lucide-svelte';
  import 'katex/dist/katex.min.css';
  import { getAuthHeader } from '$lib/app/supabase.js';
  import { user } from '$lib/stores/auth.js';
  import {
    ago,
    deleteChat,
    listChats,
    loadChat,
    MAX_TITLE,
    newChatId,
    renameChat,
    saveChat,
    searchChats
  } from '$lib/assistant/chatStore.js';
  import { renderMarkdown } from '$lib/app/miniMarkdown.js';
  import { fillBody, proposalIsSendable } from '$lib/assistant/allowedPaths.js';
  import { fetchActiveScoutingEventKey } from '$lib/scouting/scoutingEvent.js';

  // Ask questions about the scouting data in plain language. The server answers from read-only tools over the
  // event's scouting data (see src/lib/server/assistant), so every number comes from a report, not the model.
  const SUGGESTIONS = [
    { title: 'Top scorers', text: 'Who are the top 5 scorers at this event?' },
    { title: 'Reliability', text: 'Which robots break down the most?' },
    { title: 'Head to head', text: 'Compare 254 and 1678.' },
    { title: 'Pit problems', text: 'What are the open pit problems?' },
    { title: 'Autos', text: 'Which teams have the best auto?' },
    { title: 'Shooting from video', text: 'Which robots shoot the most accurately according to the match video?' }
  ];
  const TOOL_LABEL = {
    rank_teams: 'Ranked teams',
    team_report: 'Read a team report',
    compare_teams: 'Compared teams',
    search_notes: 'Searched notes',
    open_problems: 'Checked open problems',
    team_match_reports: 'Read match reports',
    vision_fuel: 'Looked at tracked shots',
    event_overview: 'Checked what data exists',
    scouts: 'Looked up scouts',
    match_overview: 'Read a match',
    match_rankings: 'Read match rankings',
    picklist: 'Read the picklist',
    vision_movement: 'Looked at robot movement',
    event_results: 'Checked Blue Alliance results',
    list_tables: 'Listed tables',
    query_table: 'Queried the database',
    export_csv: 'Prepared a file',
    export_query_csv: 'Prepared a file',
    export_table_csv: 'Prepared a file'
  };

  // ---- files the assistant prepared: a card with the file inside, downloaded from memory in the browser
  const size = (bytes) =>
    bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${Math.round(bytes / 1e3)} KB` : `${bytes} B`;
  const kind = (file) => (file.filename.split('.').pop() || 'file').toUpperCase();
  function saveFile(file) {
    if (typeof file.content !== 'string') return;
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mime || 'text/csv;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: file.filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---- changes the assistant proposed: nothing happens until the person confirms, then their own sign-in sends it
  async function confirmProposal(message, proposal) {
    if (proposal.status !== 'pending' || !proposalIsSendable(proposal)) {
      proposal.status = 'failed';
      proposal.message = 'This action cannot be sent.';
      messages = messages;
      return;
    }
    proposal.status = 'running';
    messages = messages;
    try {
      let previous = null;
      for (const request of proposal.requests) {
        const body = fillBody(request.body, previous);
        if (Object.values(body).some((v) => v === null) && Object.values(request.body).includes('$prev.data.id'))
          throw new Error('The step before it did not return an id.');
        const response = await fetch(request.path, {
          method: request.method,
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
          body: JSON.stringify(body)
        });
        previous = await response.json().catch(() => ({}));
        if (!response.ok || previous.success === false || previous.error)
          throw new Error(previous.error || `The server answered ${response.status}.`);
      }
      proposal.status = 'done';
      proposal.message = 'Done.';
    } catch (err) {
      proposal.status = 'failed';
      proposal.message = err.message;
    }
    messages = messages;
    persist();
  }
  function cancelProposal(proposal) {
    proposal.status = 'cancelled';
    messages = messages;
    persist();
  }

  let eventKey = '';
  let configured = true;
  let messages = []; // { role: 'user' | 'assistant', content, tools?: [] }
  let draft = '';
  let busy = false;
  let error = '';
  let copied = -1;
  let scroller;
  let box;
  let searchBox;

  // ---- saved chats (kept in this browser, per signed-in person; see chatStore.js)
  const SIDEBAR_KEY = 'scouting-ai-sidebar-open';
  let sidebarOpen = true;
  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    try {
      localStorage.setItem(SIDEBAR_KEY, sidebarOpen ? '1' : '0');
    } catch {
      /* storage unavailable: the choice just is not remembered */
    }
  }
  let chatId = newChatId();
  let saved = [];
  let pickerOpen = false;
  let query = '';
  let active = 0;
  let pickerEl;
  const storage = () => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  };
  $: userId = $user?.id || null;
  $: if (userId) saved = listChats(storage(), userId);
  $: matches = searchChats(saved, query);
  $: if (active >= matches.length) active = Math.max(0, matches.length - 1);

  function persist() {
    if (!userId) return;
    saveChat(storage(), userId, { id: chatId, messages, eventKey });
    saved = listChats(storage(), userId);
  }
  async function openPicker() {
    saved = userId ? listChats(storage(), userId) : [];
    query = '';
    active = 0;
    pickerOpen = !pickerOpen;
    if (pickerOpen) {
      await tick();
      searchBox?.focus();
    }
  }
  const closePicker = () => {
    pickerOpen = false;
  };
  function openChat(id) {
    const chat = userId ? loadChat(storage(), userId, id) : null;
    if (!chat) return;
    chatId = chat.id;
    messages = chat.messages;
    error = '';
    draft = '';
    pickerOpen = false;
    tick().then(() => {
      grow();
      toBottom(true);
      box?.focus();
    });
  }
  // ---- rename: one chat at a time, in whichever list it was started from
  let editingId = '';
  let editValue = '';
  const focusOnMount = (node) => {
    node.focus();
    node.select();
  };
  function startRename(chat, event) {
    event?.stopPropagation();
    editingId = chat.id;
    editValue = chat.title;
  }
  function commitRename() {
    if (!editingId) return;
    const id = editingId;
    editingId = '';
    if (userId) renameChat(storage(), userId, id, editValue);
    saved = userId ? listChats(storage(), userId) : [];
  }
  const cancelRename = () => {
    editingId = '';
  };
  function onRenameKey(event) {
    event.stopPropagation(); // keep the picker's own arrow/enter handling out of the way
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  }
  function removeChat(id, event) {
    event.stopPropagation();
    if (userId) deleteChat(storage(), userId, id);
    saved = userId ? listChats(storage(), userId) : [];
    if (id === chatId) {
      messages = [];
      chatId = newChatId();
    }
  }
  function onPickerKey(event) {
    if (event.key === 'Escape') {
      closePicker();
      box?.focus();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(matches.length - 1, active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, active - 1);
    } else if (event.key === 'Enter' && matches[active]) {
      event.preventDefault();
      openChat(matches[active].id);
    }
  }
  const onWindowClick = (event) => {
    if (pickerOpen && pickerEl && !pickerEl.contains(event.target)) closePicker();
  };

  onMount(async () => {
    try {
      sidebarOpen = localStorage.getItem(SIDEBAR_KEY) !== '0';
    } catch {
      sidebarOpen = true;
    }
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    try {
      configured = (await fetch('/api/scouting-assistant').then((r) => r.json())).configured !== false;
    } catch {
      configured = true;
    }
    box?.focus();
  });

  // The page itself scrolls (the thread is not its own scroll box), so scroll the window to an anchor at the end of
  // the thread. A long answer is scrolled to its START instead, so the person reads from the top, not the bottom.
  let endEl;
  const calm = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const toBottom = async (instant = false) => {
    await tick();
    const behavior = instant ? 'auto' : calm();
    const answers = scroller?.querySelectorAll('.row.assistant');
    const last = answers?.[answers.length - 1];
    if (!instant && last && !busy && last.offsetHeight > window.innerHeight * 0.6)
      last.scrollIntoView({ behavior, block: 'start' });
    else endEl?.scrollIntoView({ behavior, block: 'end' });
  };
  const grow = () => {
    if (box) {
      box.style.height = 'auto';
      box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
    }
  };

  async function ask(text) {
    const question = (text ?? draft).trim();
    if (!question || busy || !eventKey || !configured) return;
    draft = '';
    error = '';
    await tick();
    grow();
    messages = [...messages, { role: 'user', content: question }];
    persist();
    busy = true;
    toBottom();
    try {
      const response = await fetch('/api/scouting-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          event_key: eventKey,
          messages: messages.map(({ role, content }) => ({ role, content }))
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) throw new Error(body.error || 'The assistant could not answer.');
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: body.answer,
          tools: body.toolsUsed || [],
          files: (body.downloads || []).map((d) => ({ ...d, bytes: d.content?.length || 0 })),
          proposals: (body.proposals || []).map((p) => ({ ...p, status: 'pending', message: null }))
        }
      ];
      persist();
    } catch (err) {
      error = err.message;
    } finally {
      busy = false;
      toBottom();
      box?.focus();
    }
  }

  function newChat() {
    chatId = newChatId();
    messages = [];
    error = '';
    draft = '';
    pickerOpen = false;
    tick().then(() => {
      grow();
      box?.focus();
    });
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
  const label = (tools) => [...new Set((tools || []).map((t) => TOOL_LABEL[t.name] || t.name))].join(' · ');
  $: disabled = !eventKey || !configured;
</script>

<svelte:head><title>AI analytics</title></svelte:head>
<svelte:window on:click={onWindowClick} />

<div class="shell" class:collapsed={!sidebarOpen}>
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
              {#if editingId === c.id}
                <input
                  class="rename"
                  bind:value={editValue}
                  maxlength={MAX_TITLE}
                  aria-label="Chat name"
                  use:focusOnMount
                  on:keydown={onRenameKey}
                  on:blur={commitRename}
                  on:click|stopPropagation
                />
              {:else}
                <span class="name" role="presentation" on:dblclick={(e) => startRename(c, e)}>{c.title}</span>
              {/if}
              <span class="when">{ago(c.updatedAt)}</span>
              <button
                type="button"
                class="pen"
                aria-label={`Rename chat ${c.title}`}
                title="Rename"
                on:click={(e) => startRename(c, e)}><Pencil size={13} /></button
              >
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
      <span class="event">{eventKey ? `Event ${eventKey}` : 'no active event'}</span>
      <div class="actions">
        <div class="picker" bind:this={pickerEl}>
          <button
            class="new"
            type="button"
            on:click={openPicker}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            title="Open an earlier chat"><FolderOpen size={16} /> Load chats <ChevronDown size={14} /></button
          >
          {#if pickerOpen}
            <div class="menu" role="dialog" tabindex="-1" aria-label="Saved chats" on:keydown={onPickerKey}>
              <label class="find"
                ><Search size={15} /><input
                  bind:this={searchBox}
                  bind:value={query}
                  type="search"
                  placeholder="Search chats"
                  aria-label="Search chats"
                  autocomplete="off"
                /></label
              >
              <ul class="chats" role="listbox" aria-label="Saved chats">
                {#each matches as c, i (c.id)}
                  <li role="option" aria-selected={c.id === chatId}>
                    <div
                      class="chat-item"
                      class:on={i === active}
                      class:current={c.id === chatId}
                      role="button"
                      tabindex="-1"
                      on:click={() => openChat(c.id)}
                      on:keydown={() => {}}
                      on:mousemove={() => (active = i)}
                    >
                      {#if editingId === c.id}
                        <input
                          class="rename"
                          bind:value={editValue}
                          maxlength={MAX_TITLE}
                          aria-label="Chat name"
                          use:focusOnMount
                          on:keydown={onRenameKey}
                          on:blur={commitRename}
                          on:click|stopPropagation
                        />
                      {:else}
                        <span class="name" role="presentation" on:dblclick={(e) => startRename(c, e)}>{c.title}</span>
                      {/if}
                      <span class="when">{ago(c.updatedAt)} · {c.count} message{c.count === 1 ? '' : 's'}</span>
                      <button
                        type="button"
                        class="pen"
                        aria-label={`Rename chat ${c.title}`}
                        title="Rename"
                        on:click={(e) => startRename(c, e)}><Pencil size={13} /></button
                      >
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
                  <li class="none">
                    {saved.length
                      ? 'No chats match your search.'
                      : 'No saved chats yet. Ask something and it will be saved here.'}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
        <button
          class="new"
          type="button"
          on:click={newChat}
          disabled={!messages.length && !draft}
          title="Start a new chat"><SquarePen size={16} /> New chat</button
        >
      </div>
    </header>

    {#if !configured}
      <div class="notice">
        The assistant has no model key configured on this server yet. An admin sets <code>GEMINI_API_KEY</code> or
        <code>OPENAI_API_KEY</code>.
      </div>
    {/if}

    <div class="scroll" bind:this={scroller} aria-live="polite">
      {#if !messages.length}
        <div class="welcome">
          <div class="mark"><Sparkles size={22} /></div>
          <h1>What do you want to know?</h1>
          <p>
            Ask about teams, matches and problems at {eventKey || 'the active event'}. Answers come from our own
            scouting reports, pit scouting, notes and tracked match video. It can read them but not change anything.
          </p>
          <div class="suggestions">
            {#each SUGGESTIONS as s}
              <button type="button" class="suggestion" {disabled} on:click={() => ask(s.text)}>
                <b>{s.title}</b><span>{s.text}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="thread">
          {#each messages as m, i}
            {#if m.role === 'user'}
              <div class="row user"><div class="user-bubble">{m.content}</div></div>
            {:else}
              <div class="row assistant">
                <div class="avatar"><Sparkles size={15} /></div>
                <div class="body">
                  <div class="md" class:fresh={i === messages.length - 1}>{@html renderMarkdown(m.content)}</div>
                  {#each m.files || [] as file}
                    <div class="file" role="group" aria-label={`File ${file.filename}`}>
                      <span class="file-icon"><FileSpreadsheet size={20} /></span>
                      <span class="file-text">
                        <b>{file.filename}</b>
                        <small
                          >{kind(file)}{file.rows != null ? ` · ${file.rows} row${file.rows === 1 ? '' : 's'}` : ''} · {size(
                            file.bytes || 0
                          )}{typeof file.content !== 'string' ? ' · not kept with this chat' : ''}</small
                        >
                      </span>
                      <button
                        type="button"
                        class="file-get"
                        disabled={typeof file.content !== 'string'}
                        on:click={() => saveFile(file)}
                        aria-label={`Download ${file.filename}`}><Download size={15} /> Download</button
                      >
                    </div>
                  {/each}
                  {#each m.proposals || [] as proposal (proposal.id)}
                    <div
                      class="proposal"
                      class:done={proposal.status === 'done'}
                      class:failed={proposal.status === 'failed'}
                      role="group"
                      aria-label="Proposed change"
                    >
                      <div class="p-head">
                        Proposed change{#if proposal.requests?.length > 1}
                          <small>· {proposal.requests.length} steps</small>{/if}
                      </div>
                      <p>{proposal.summary}</p>
                      {#if proposal.status === 'pending' || proposal.status === 'running'}
                        <div class="p-actions">
                          <button
                            type="button"
                            class="p-yes"
                            disabled={proposal.status === 'running'}
                            on:click={() => confirmProposal(m, proposal)}
                            ><Check size={14} /> {proposal.status === 'running' ? 'Working…' : 'Confirm'}</button
                          >
                          <button
                            type="button"
                            class="p-no"
                            disabled={proposal.status === 'running'}
                            on:click={() => cancelProposal(proposal)}><X size={14} /> Cancel</button
                          >
                        </div>
                      {:else}
                        <div class="p-state">
                          {proposal.status === 'done'
                            ? '✓ Done'
                            : proposal.status === 'cancelled'
                              ? 'Cancelled, nothing was changed'
                              : `✕ Not done: ${proposal.message || 'it failed'}`}
                        </div>
                      {/if}
                    </div>
                  {/each}
                  <div class="meta">
                    {#if m.tools?.length}<span class="muted">{label(m.tools)}</span>{/if}
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
          maxlength="2000"
          {disabled}
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          placeholder="Ask about a team, a metric or a problem"
          aria-label="Message"
        ></textarea>
        <button class="send" type="submit" disabled={busy || !draft.trim() || disabled} aria-label="Send"
          ><ArrowUp size={18} /></button
        >
      </form>
      <small class="foot"
        >AI can be wrong. Numbers come from scouting reports and tracker measurements; check anything you will act on,
        and note how many matches were scouted behind it.</small
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
  /* The page fills exactly the space under the app bar (inside the stage's padding), so the browser window never
     scrolls: only the conversation, and the chat list when it is long, scroll inside it. */
  .shell {
    --pad-y: calc(2 * var(--space-5));
    height: calc(calc(100 * var(--vh)) - var(--strip-height, 3.25rem) - var(--pad-y));
    height: calc(calc(100 * var(--vh)) - var(--strip-height, 3.25rem) - var(--pad-y));
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
  /* the contents keep their full width while the track shrinks, so text does not rewrap mid-animation */
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
  /* stays under the app's top bar while the thread scrolls, on a solid background so text never shows through it */
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
  .picker {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 20;
    width: min(360px, calc(92 * var(--vw)));
    border: 1px solid var(--chat-line);
    border-radius: 0.9rem;
    background: var(--background, Canvas);
    box-shadow: var(--shadow-pop);
    overflow: hidden;
    animation: rise 0.15s ease-out both;
  }
  .find {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid var(--chat-line);
    color: var(--chat-dim);
  }
  .find input {
    flex: 1;
    border: 0;
    outline: 0;
    box-shadow: none;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .chats {
    list-style: none;
    margin: 0;
    padding: 0.3rem;
    max-height: 320px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .chat-item {
    position: relative;
    display: grid;
    gap: 0.1rem;
    padding: 0.5rem 2.2rem 0.5rem 0.65rem;
    border-radius: 0.6rem;
    cursor: pointer;
  }
  .chat-item.on {
    background: var(--chat-hover);
  }
  .chat-item.current .name::after {
    content: ' · open';
    color: var(--brand-gold-base, #c9a64e);
    font-weight: 400;
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
  .pen {
    position: absolute;
    right: 1.9rem;
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
  .chat-item:hover .pen,
  .chat-item.on .pen,
  .h-item:hover .pen,
  .h-item:focus-within .pen,
  .pen:focus-visible {
    opacity: 1;
  }
  .pen:hover {
    color: inherit;
    background: var(--chat-fill);
  }
  .chat-item,
  .h-item {
    padding: 0.5rem 0.65rem;
    gap: 0.2rem;
  }
  /* the action buttons float over the end of the first line only while hovered, so titles get the full width */
  .h-item .pen,
  .h-item .del,
  .chat-item .pen,
  .chat-item .del {
    background: var(--background, Canvas);
    border: 1px solid var(--chat-line);
  }
  .rename {
    width: 100%;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    background: var(--chat-fill);
    border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
    border-radius: 0.4rem;
    padding: 0.15rem 0.4rem;
    outline: 0;
    box-shadow: none;
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
  .chat-item:hover .del,
  .chat-item.on .del,
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
  /* the newest answer's blocks fade in one after another, like it is being written */
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
  .file {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.6rem 0 0;
    padding: 0.65rem 0.8rem;
    max-width: 460px;
    border: 1px solid var(--chat-line);
    border-radius: 0.8rem;
    background: var(--chat-fill);
    animation: rise 0.3s ease-out both;
  }
  .file-icon {
    flex: none;
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border-radius: 0.6rem;
    background: color-mix(in srgb, var(--success) 22%, transparent);
    color: var(--success);
  }
  .file-text {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 0.1rem;
  }
  .file-text b {
    font-size: 0.86rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-text small {
    color: var(--chat-dim);
    font-size: 0.74rem;
  }
  .file-get {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    border: 1px solid var(--chat-line);
    border-radius: 0.6rem;
    padding: 0.35rem 0.65rem;
    cursor: pointer;
  }
  .file-get:hover:not(:disabled) {
    background: var(--chat-hover);
  }
  .file-get:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .proposal {
    margin: 0.6rem 0 0;
    padding: 0.7rem 0.85rem;
    max-width: 520px;
    border: 1px solid var(--chat-line);
    border-left: 3px solid var(--chat-dim);
    border-radius: 0.7rem;
    background: var(--chat-fill);
    animation: rise 0.3s ease-out both;
  }
  .proposal.done {
    border-left-color: var(--success);
  }
  .proposal.failed {
    border-left-color: var(--danger, #e24b4b);
  }
  .p-head {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--chat-dim);
  }
  .proposal p {
    margin: 0.3rem 0 0.5rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .p-actions {
    display: flex;
    gap: 0.5rem;
  }
  .p-yes,
  .p-no {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font: inherit;
    font-size: 0.8rem;
    border-radius: 0.6rem;
    padding: 0.35rem 0.8rem;
    cursor: pointer;
    border: 1px solid var(--chat-line);
    background: transparent;
    color: inherit;
  }
  .p-yes {
    background: var(--brand-gold-base, #c9a64e);
    border-color: transparent;
    color: #111;
  }
  .p-yes:disabled,
  .p-no:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .p-no:hover:not(:disabled) {
    background: var(--chat-hover);
  }
  .p-state {
    font-size: 0.82rem;
    color: var(--chat-dim);
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
  /* the app's global textarea rule asks for 2.5 controls of height, which made one line look like a form box */
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

  /* Phone: wrap, never cut text (#124). On phones these lines wrap instead of ending in "...". */
  @media (max-width: 900px) {
    .file-text b {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      overflow-wrap: anywhere;
    }
  }
</style>

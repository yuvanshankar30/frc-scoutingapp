<script>
  // Scouting Admin > Edit: a visual designer for the match and pit scouting forms. The canvas is the live form, laid
  // out exactly as scouts see it; drag a question type from the palette onto a section, drag cards to reorder them or
  // move them between sections, drag a card's right edge to resize it, and change everything else in the panel on the
  // right. Work is saved as a draft automatically; Publish makes it the live form. Every published version is kept in
  // History and can be brought back. The built-in form (src/lib/scouting/forms/formSchema.js) is always the baseline.
  import { onDestroy, onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import {
    AlignLeft,
    ChevronsUpDown,
    CircleDot,
    Grid3x3,
    Hash,
    History,
    Image,
    Download,
    Monitor,
    Upload,
    MousePointerClick,
    Plus,
    Redo2,
    Rocket,
    Smartphone,
    SlidersHorizontal,
    SquareCheck,
    Star,
    ToggleLeft,
    Type,
    Undo2
  } from 'lucide-svelte';
  import DesignerInspector from './DesignerInspector.svelte';
  import Dialog from '$lib/components/common/Dialog.svelte';
  import { requestConfirmation } from '$lib/app/confirmation.js';
  import {
    FORM_TYPES,
    QUESTION_TYPES,
    convertQuestion,
    coreBlocksIn,
    createQuestion,
    describeDiff,
    diffForms,
    emptyForm,
    formFromFile,
    formProblems,
    formToFile,
    newQuestionId,
    sanitizeForm,
    sectionItems,
    shownOnKind
  } from '$lib/scouting/forms/formSchema.js';
  import { canRedo, canUndo, createHistory, pushHistory, redo, undo } from '$lib/scouting/forms/history.js';
  import { discardDraft, loadAdminForm, publishForm, saveDraft } from '$lib/scouting/forms/formsClient.js';

  const ICONS = {
    MousePointerClick,
    CircleDot,
    SquareCheck,
    ChevronsUpDown,
    ToggleLeft,
    Star,
    Plus,
    Hash,
    Type,
    AlignLeft,
    SlidersHorizontal,
    Image,
    Grid3x3
  };
  // Which kind of match scouting each section belongs to; pre-match and post-match are on every kind.
  const SECTION_KIND = { auto: 'data', teleop: 'data', shuttling: 'data', performance: 'performance', robot: 'robot' };
  const KINDS = [
    ['', 'Every kind'],
    ['data', 'Data'],
    ['performance', 'Performance'],
    ['robot', 'Robot']
  ];
  const SAVE_DELAY_MS = 900;

  let formType = 'match';
  let loading = true;
  let loadError = '';
  let liveVersion = 0;
  let versions = [];
  let liveForm = emptyForm();
  let hist = createHistory(emptyForm());
  let saveState = 'idle';
  let savedAt = null;
  let saveTimer = null;
  let publishing = false;
  let note = '';
  let banner = null;
  let bannerTimer = null;
  let restoredFrom = null;
  let selectedId = null;
  let kindView = '';
  let device = 'desktop';
  let historyOpen = false;
  let viewing = null;
  let frame;
  let frameReady = false;
  let framePhase = '';
  let frameKind = 'data';

  // Pit scouting has one page; match scouting opens on the kind picked in the toolbar.
  $: frameSrc = formType === 'pit' ? '/pitscout?design=1' : `/matchscout?design=1&tab=${kindView || 'data'}`;
  // A new page in the frame has to say it is ready again before it is sent anything.
  let readySrc = '';
  $: if (frameSrc !== readySrc) frameReady = false;
  // Sends the draft (or the version being viewed) to the page in the frame whenever either changes.
  $: if (frameReady && frame) sendToFrame(shown, selectedId, kindView);
  function sendToFrame(schema, selected, kind, phase = null) {
    frame?.contentWindow?.postMessage(
      { type: 'form-design', schema, selectedId: selected, version: liveVersion, kind: kind || undefined, phase },
      window.location.origin
    );
  }
  function showPhase(phase) {
    framePhase = phase;
    const sectionKind = SECTION_KIND[phase];
    if (formType === 'match' && sectionKind && kindView && sectionKind !== kindView) kindView = sectionKind;
    sendToFrame(shown, selectedId, kindView || sectionKind || frameKind, phase);
  }
  function onFrameMessage(event) {
    if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return;
    const data = event.data || {};
    if (data.type === 'design-ready') {
      readySrc = frameSrc;
      frameReady = true;
      sendToFrame(shown, selectedId, kindView);
    } else if (data.type === 'design-view') {
      framePhase = data.phase;
      frameKind = data.kind;
    } else if (data.type === 'design-select') {
      if (findItem(shown, data.id)) selectedId = data.id;
    } else if (data.type === 'design-move' && !readonly) {
      const target = data.beforeId ? findItem(form, data.beforeId) : null;
      moveItem(data.id, target?.section || data.section, target ? data.beforeId : null);
    } else if (data.type === 'design-add' && !readonly && QUESTION_TYPES[data.questionType]) {
      const target = data.beforeId ? findItem(form, data.beforeId) : null;
      const section = target?.section || (sections.some((entry) => entry.id === data.section) ? data.section : sections[0].id);
      addQuestion(data.questionType, section, target ? data.beforeId : null);
    }
  }

  $: form = hist.present;
  $: sections = FORM_TYPES[formType].sections;
  $: viewingEntry = viewing ? versions.find((entry) => entry.version === viewing) : null;
  $: shown = viewingEntry ? viewingEntry.schema : form;
  $: readonly = Boolean(viewingEntry);
  $: problems = formProblems(form);
  $: diff = diffForms(liveForm, form, formType);
  $: visibleSections = sections.filter(
    (entry) => formType !== 'match' || !kindView || !SECTION_KIND[entry.id] || SECTION_KIND[entry.id] === kindView
  );
  $: itemsBySection = Object.fromEntries(
    sections.map((entry) => [
      entry.id,
      sectionItems(shown, formType, entry.id).filter(
        (item) => item.kind === 'core' || formType !== 'match' || shownOnKind(item.question, kindView)
      )
    ])
  );
  $: selected = findItem(shown, selectedId);

  function findItem(source, id) {
    if (!id) return null;
    for (const entry of sections) {
      const item = sectionItems(source, formType, entry.id).find((candidate) => candidate.id === id);
      if (item) return { ...item, section: entry.id };
    }
    return null;
  }

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  function say(text, kind = 'ok', ms = 6000) {
    banner = { text, kind };
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => (banner = null), ms);
  }

  async function load(type) {
    loading = true;
    loadError = '';
    viewing = null;
    selectedId = null;
    restoredFrom = null;
    try {
      const data = await loadAdminForm(type);
      liveVersion = data.live_version;
      versions = data.versions;
      liveForm = versions[0]?.schema || emptyForm();
      hist = createHistory(data.draft ? data.draft.schema : liveForm);
      saveState = data.draft ? 'saved' : 'idle';
      savedAt = data.draft?.updated_at || null;
      if (data.draft && data.draft.base_version !== liveVersion)
        say(
          `This draft was started on version ${data.draft.base_version || 'none'}; version ${liveVersion} has been published since.`,
          'warn',
          0
        );
    } catch (error) {
      loadError = error.message;
    } finally {
      loading = false;
    }
  }

  async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saveState !== 'dirty') return;
    saveState = 'saving';
    try {
      await saveDraft(formType, form, liveVersion);
      saveState = saveTimer ? 'dirty' : 'saved';
      savedAt = new Date().toISOString();
    } catch {
      saveState = 'error';
    }
  }
  function markDirty() {
    saveState = 'dirty';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }
  function commit(next, group = null) {
    if (readonly) return;
    const before = hist;
    hist = pushHistory(hist, next, group);
    if (hist !== before) markDirty();
  }
  function step(fn) {
    const before = hist;
    hist = fn(hist);
    if (hist !== before) markDirty();
  }

  // --- Order helpers. A section's order is the list of every item id in it; built-ins included.
  const idsIn = (sectionId, source = form) => sectionItems(source, formType, sectionId).map((item) => item.id);
  const withoutId = (order, id) =>
    Object.fromEntries(
      Object.entries(order || {})
        .map(([key, ids]) => [key, ids.filter((entry) => entry !== id)])
        .filter(([, ids]) => ids.length)
    );
  function place(ids, id, beforeId) {
    const next = ids.filter((entry) => entry !== id);
    const at = beforeId ? next.indexOf(beforeId) : -1;
    next.splice(at < 0 ? next.length : at, 0, id);
    return next;
  }

  function addQuestion(type, sectionId, beforeId = null) {
    const question = createQuestion(type, sectionId);
    const ids = place([...idsIn(sectionId), question.id], question.id, beforeId);
    commit({ ...form, questions: [...form.questions, question], order: { ...form.order, [sectionId]: ids } });
    selectedId = question.id;
  }

  function moveItem(id, sectionId, beforeId = null) {
    const item = findItem(form, id);
    if (!item) return;
    // Built-in blocks keep their section; only their place in it changes.
    const target = item.kind === 'core' ? item.section : sectionId;
    const questions =
      item.kind === 'custom'
        ? form.questions.map((question) => (question.id === id ? { ...question, section: target } : question))
        : form.questions;
    const base = { ...form, questions };
    const order = withoutId(form.order, id);
    const ids = place(idsIn(target, { ...base, order }), id, beforeId);
    commit({ ...base, order: { ...order, [target]: ids } });
  }

  function nudge(direction) {
    if (!selected) return;
    const ids = idsIn(selected.section);
    const at = ids.indexOf(selected.id);
    const to = at + direction;
    if (to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    commit({ ...form, order: { ...form.order, [selected.section]: ids } });
  }

  const patchQuestion = (id, changes, group) =>
    commit(
      { ...form, questions: form.questions.map((question) => (question.id === id ? { ...question, ...changes } : question)) },
      group ? `${id}:${group}` : null
    );

  function patchCore(key, changes, group) {
    const entry = sections.flatMap((s) => coreBlocksIn(formType, s.id)).find((candidate) => candidate.key === key);
    const merged = { ...(form.core?.[key] || {}), ...changes };
    if (merged.label !== undefined && (!merged.label.trim() || merged.label === entry.label)) delete merged.label;
    if (merged.help !== undefined && merged.help === entry.help) delete merged.help;
    if (!merged.hidden) delete merged.hidden;
    if (merged.required === entry.required) delete merged.required;
    const core = { ...(form.core || {}) };
    if (Object.keys(merged).length) core[key] = merged;
    else delete core[key];
    commit({ ...form, core }, group ? `${key}:${group}` : null);
  }

  // A card's style from the inspector or a resize; defaults are dropped so the stored form stays small.
  function setStyle(item, style) {
    const clean = {};
    if (style.size && style.size !== 'auto') clean.size = style.size;
    if (style.textSize && style.textSize !== 'md') clean.textSize = style.textSize;
    if (style.accent) clean.accent = style.accent;
    if (style.image) clean.image = style.image;
    const value = Object.keys(clean).length ? clean : undefined;
    if (item.kind === 'custom') patchQuestion(item.id, { style: value }, 'style');
    else patchCore(item.block.key, { style: value }, 'style');
  }

  function removeSelected() {
    if (selected?.kind !== 'custom') return;
    commit({
      ...form,
      questions: form.questions.filter((question) => question.id !== selected.id),
      order: withoutId(form.order, selected.id)
    });
    say('Question deleted. Undo brings it back.');
    selectedId = null;
  }

  function duplicateSelected() {
    if (selected?.kind !== 'custom') return;
    const original = selected.question;
    const copy = {
      ...structuredClone(original),
      id: newQuestionId(),
      label: original.label ? `${original.label} (copy)` : ''
    };
    copy.options = copy.options?.map((option) => ({ ...option, id: `o_${Math.random().toString(36).slice(2, 10)}` }));
    if (!copy.options) delete copy.options;
    const ids = idsIn(selected.section);
    ids.splice(ids.indexOf(original.id) + 1, 0, copy.id);
    commit({ ...form, questions: [...form.questions, copy], order: { ...form.order, [selected.section]: ids } });
    selectedId = copy.id;
  }

  // --- Drag and drop. Palette types add a question; cards move.
  // A question type dragged from the palette onto the page in the frame.
  function startDrag(event, { type }) {
    if (readonly) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', `design-new:${type}`);
  }



  // --- Versions.
  function restore(entry) {
    commit(sanitizeForm(structuredClone(entry.schema), formType));
    restoredFrom = entry.version;
    viewing = null;
    historyOpen = false;
    say(`Version ${entry.version} is in your draft. Publish it to make it live; Undo brings your draft back.`);
  }
  async function restoreBuiltIn() {
    const ok = await requestConfirmation({
      title: 'Start from the built-in form?',
      message: 'Your draft becomes the built-in form with no added questions and no changes. Publish to make it live.',
      confirmLabel: 'Use the built-in form'
    });
    if (!ok) return;
    commit(emptyForm());
    restoredFrom = null;
    viewing = null;
    historyOpen = false;
    say('The built-in form is in your draft. Undo brings your draft back.');
  }

  async function discard() {
    const ok = await requestConfirmation({
      title: 'Discard your draft?',
      message: `Your unpublished changes go away and the draft returns to version ${liveVersion || 'the built-in form'}.`,
      confirmLabel: 'Discard draft',
      danger: true
    });
    if (!ok) return;
    clearTimeout(saveTimer);
    try {
      await discardDraft(formType);
    } catch (error) {
      say(error.message, 'error');
      return;
    }
    hist = createHistory(liveForm);
    saveState = 'idle';
    say('Draft discarded.');
  }

  async function publish() {
    const ids = Object.keys(problems);
    if (ids.length) {
      selectedId = ids[0];
      say(`Fix the ${ids.length === 1 ? 'highlighted question' : `${ids.length} highlighted questions`} first.`, 'error');
      return;
    }
    if (!diff.changed) {
      say('There is nothing new to publish.', 'error');
      return;
    }
    const next = liveVersion + 1;
    const ok = await requestConfirmation({
      title: `Publish version ${next}?`,
      message: `This becomes the live ${FORM_TYPES[formType].label.toLowerCase()} form: ${describeDiff(diff).toLowerCase()}. Reports already sent keep the version they were answered with, and History can bring any version back.`,
      confirmLabel: `Publish version ${next}`
    });
    if (!ok) return;
    publishing = true;
    try {
      await flushSave();
      const source = restoredFrom ? versions.find((entry) => entry.version === restoredFrom) : null;
      await publishForm(formType, form, liveVersion, note, source && !diffForms(source.schema, form, formType).changed ? restoredFrom : null);
      note = '';
      await load(formType);
      say(`Version ${next} is live.`);
    } catch (error) {
      say(error.message, 'error', 0);
      if (error.status === 409) await load(formType);
    } finally {
      publishing = false;
    }
  }

  async function switchForm(type) {
    if (type === formType || loading) return;
    await flushSave();
    formType = type;
    kindView = '';
    await load(type);
  }

  // A form leaves and enters as a file in the same format as the repo's scouting-forms/ folder.
  function exportForm() {
    const file = formToFile(formType, form, { exportedAt: new Date().toISOString(), basedOnVersion: liveVersion });
    const blob = new Blob([JSON.stringify(file, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), {
      href: url,
      download: `${formType}-scouting-form${liveVersion ? `-v${liveVersion}` : ''}.json`
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importForm(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const read = formFromFile(await file.text(), formType);
    if (read.error) {
      say(read.error, 'error');
      return;
    }
    commit(read.schema);
    restoredFrom = null;
    selectedId = null;
    say(
      `Imported ${file.name} into your draft. ${read.warnings.join(' ')} Publish to make it live; Undo brings your draft back.`,
      read.warnings.length ? 'warn' : 'ok',
      read.warnings.length ? 0 : 8000
    );
  }

  function onKeydown(event) {
    if (!(event.metaKey || event.ctrlKey) || event.target?.closest?.('input, textarea, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      step(undo);
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      step(redo);
    }
  }

  onMount(() => {
    window.addEventListener('message', onFrameMessage);
    load(formType);
    return () => window.removeEventListener('message', onFrameMessage);
  });
  onDestroy(() => {
    clearTimeout(bannerTimer);
    if (saveState === 'dirty') flushSave();
  });

  $: saveLabel = {
    idle: liveVersion ? `Version ${liveVersion} is live` : 'The built-in form is live',
    dirty: 'Unsaved changes…',
    saving: 'Saving draft…',
    saved: `Draft saved${savedAt ? ` ${fmt(savedAt)}` : ''}`,
    error: 'Could not save the draft'
  }[saveState];
</script>

<svelte:window on:keydown={onKeydown} />

<div class="designer">
  <header class="topbar">
    <div class="seg" role="tablist" aria-label="Form">
      {#each Object.entries(FORM_TYPES) as [key, entry] (key)}
        <button role="tab" aria-selected={formType === key} class:on={formType === key} on:click={() => switchForm(key)}
          >{entry.label}</button
        >
      {/each}
    </div>
    {#if formType === 'match'}
      <div class="seg" aria-label="Show the form for">
        {#each KINDS as [key, label] (key)}
          <button class:on={kindView === key} aria-pressed={kindView === key} on:click={() => (kindView = key)}
            >{label}</button
          >
        {/each}
      </div>
    {/if}
    <div class="seg" aria-label="Preview size">
      <button class:on={device === 'desktop'} aria-label="Desktop" title="Desktop" on:click={() => (device = 'desktop')}
        ><Monitor size={15} /></button
      >
      <button class:on={device === 'phone'} aria-label="Phone" title="Phone" on:click={() => (device = 'phone')}
        ><Smartphone size={15} /></button
      >
    </div>
    <span class="save" class:err={saveState === 'error'}>{saveLabel}</span>
    <div class="tb-actions">
      <button class="icon-btn" title="Undo (Ctrl Z)" aria-label="Undo" disabled={!canUndo(hist) || readonly} on:click={() => step(undo)}
        ><Undo2 size={16} /></button
      >
      <button class="icon-btn" title="Redo (Ctrl Shift Z)" aria-label="Redo" disabled={!canRedo(hist) || readonly} on:click={() => step(redo)}
        ><Redo2 size={16} /></button
      >
      <button class="btn btn-outline btn-sm" on:click={() => (historyOpen = true)}><History size={15} /> History</button>
      <button class="btn btn-outline btn-sm" title="Download this form as a file" on:click={exportForm}
        ><Download size={15} /> Export</button
      >
      <label class="btn btn-outline btn-sm" class:disabled={readonly} title="Load a form file into your draft"
        ><Upload size={15} /> Import<input type="file" accept="application/json,.json" hidden disabled={readonly} on:change={importForm} /></label
      >
      {#if saveState !== 'idle'}
        <button class="btn btn-outline btn-sm" on:click={discard}>Discard draft</button>
      {/if}
      <button class="btn btn-primary btn-sm" disabled={publishing || !diff.changed || readonly} on:click={publish}
        ><Rocket size={15} /> Publish</button
      >
    </div>
  </header>

  {#if banner}
    <div class="banner {banner.kind}" role="status" transition:fade={{ duration: 150 }}>{banner.text}</div>
  {/if}
  {#if viewingEntry}
    <div class="banner warn" transition:fade={{ duration: 150 }}>
      Viewing version {viewingEntry.version}{viewingEntry.note ? ` · ${viewingEntry.note}` : ''}.
      <button class="link" on:click={() => restore(viewingEntry)}>Bring this version back</button> ·
      <button class="link" on:click={() => (viewing = null)}>Back to my draft</button>
    </div>
  {/if}

  {#if loading}
    <p class="muted">Loading the form…</p>
  {:else if loadError}
    <div class="status-message status-error">{loadError}</div>
  {:else}
    <div class="workspace">
      <aside class="palette" aria-label="Add a question">
        <h4>Add a question</h4>
        <p class="hint">Drag onto a section, or click to add it to the selected card's section.</p>
        <div class="types">
          {#each Object.entries(QUESTION_TYPES) as [key, type] (key)}
            <button
              class="type"
              draggable={!readonly}
              disabled={readonly}
              title={type.blurb}
              on:dragstart={(event) => startDrag(event, { type: key })}
              on:click={() => addQuestion(key, selected?.section || framePhase || visibleSections[0].id)}
            >
              <svelte:component this={ICONS[type.icon] || Plus} size={16} /><span>{type.label}</span>
            </button>
          {/each}
        </div>
        <h4>Outline</h4>
        <nav class="outline">
          {#each visibleSections as entry (entry.id)}
            <button class="ol-section" class:on={framePhase === entry.id} on:click={() => showPhase(entry.id)}
              >{entry.label}<small>{itemsBySection[entry.id]?.length || 0}</small></button
            >
            {#each itemsBySection[entry.id] || [] as item (item.id)}
              <button
                class="ol-item"
                class:on={selectedId === item.id}
                class:off={item.kind === 'core' && item.view.hidden}
                on:click={() => {
                  selectedId = item.id;
                  showPhase(entry.id);
                }}>{item.kind === 'core' ? item.view.label : item.question.label || 'Untitled question'}</button
              >
            {/each}
          {/each}
        </nav>
      </aside>

      <div class="canvas-wrap">
        <!-- The real scouting page, in design mode: exactly what a scout sees, edited in place. -->
        <div class="frame-shell" class:phone={device === 'phone'}>
          <iframe
            bind:this={frame}
            title="The scouting form as a scout sees it"
            referrerpolicy="strict-origin-when-cross-origin"
            src={frameSrc}
          ></iframe>
        </div>
      </div>

      <aside class="inspector" aria-label="Settings for the selected card">
        <DesignerInspector
          item={selected}
          {formType}
          {sections}
          {readonly}
          problems={selected ? problems[selected.id] || [] : []}
          on:patch={(event) => patchQuestion(selected.id, event.detail.changes, event.detail.group)}
          on:core={(event) => patchCore(selected.block.key, event.detail.changes, event.detail.group)}
          on:style={(event) => setStyle(selected, event.detail)}
          on:convert={(event) =>
            commit({
              ...form,
              questions: form.questions.map((q) => (q.id === selected.id ? convertQuestion(q, event.detail) : q))
            })}
          on:section={(event) => moveItem(selected.id, event.detail)}
          on:move={(event) => nudge(event.detail)}
          on:duplicate={duplicateSelected}
          on:remove={removeSelected}
          on:reset={() => {
            const core = { ...(form.core || {}) };
            delete core[selected.block.key];
            commit({ ...form, core });
          }}
        />
        {#if diff.changed && !readonly}
          <div class="pub" transition:fly={{ y: 8, duration: 160 }}>
            <span class="label">Changes since version {liveVersion || 0}</span>
            <p>{describeDiff(diff)}</p>
            <input class="form-input" maxlength="300" placeholder="Note for this version (optional)" bind:value={note} />
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<Dialog bind:open={historyOpen} title="History" subtitle="Every published version. Bring one back into your draft, then publish it." width="38rem">
  <ul class="versions">
    {#each versions as entry, index (entry.version)}
      {@const previous = versions[index + 1]}
      <li class:live={index === 0}>
        <div class="v-main">
          <b>Version {entry.version}{index === 0 ? ' · live' : ''}</b>
          <small
            >{fmt(entry.published_at)}{entry.published_by ? ` · ${entry.published_by}` : ''}{entry.restored_from
              ? ` · restored from ${entry.restored_from}`
              : ''}</small
          >
          {#if entry.note}<p>{entry.note}</p>{/if}
          <small class="v-diff">{describeDiff(diffForms(previous?.schema || emptyForm(), entry.schema, formType))}</small>
        </div>
        <div class="v-actions">
          <button
            class="btn btn-outline btn-sm"
            on:click={() => {
              viewing = entry.version;
              historyOpen = false;
            }}>View</button
          >
          <button class="btn btn-outline btn-sm" on:click={() => restore(entry)}>Bring back</button>
        </div>
      </li>
    {:else}
      <li class="none">Nothing has been published yet: scouts get the built-in form.</li>
    {/each}
    <li class="builtin">
      <div class="v-main">
        <b>The built-in form</b>
        <small>The form the app ships with, with no added questions or changes.</small>
      </div>
      <div class="v-actions"><button class="btn btn-outline btn-sm" on:click={restoreBuiltIn}>Start from it</button></div>
    </li>
  </ul>
</Dialog>

<style>
  .designer {
    display: grid;
    gap: var(--space-3);
  }
  .muted {
    color: var(--text-muted);
  }
  .topbar {
    position: sticky;
    top: calc(var(--strip-height, 3rem) + 1px);
    z-index: 6;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface-1) 92%, transparent);
    backdrop-filter: blur(10px);
  }
  .seg {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    min-height: 1.9rem;
    padding: 0 0.75rem;
    border: 0;
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.85rem;
    white-space: nowrap;
    cursor: pointer;
  }
  .seg button.on {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--text-strong, var(--text));
  }
  .save {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .save.err {
    color: var(--danger);
  }
  .tb-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .banner {
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    font-size: 0.88rem;
  }
  .banner.error {
    border-color: color-mix(in srgb, var(--danger) 50%, transparent);
  }
  .banner.warn {
    border-color: color-mix(in srgb, var(--warning) 50%, transparent);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  /* Palette | canvas | inspector. */
  .workspace {
    display: grid;
    grid-template-columns: 13rem minmax(0, 1fr) 21rem;
    gap: var(--space-4);
    align-items: start;
  }
  .palette,
  .inspector {
    position: sticky;
    top: calc(var(--strip-height, 3rem) + 4.5rem);
    max-height: calc(100 * var(--vh) - var(--strip-height, 3rem) - 6rem);
    overflow-y: auto;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .palette h4 {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .palette h4 + .hint {
    margin: 0 0 var(--space-3);
    color: var(--text-muted);
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .types {
    display: grid;
    gap: 4px;
    margin-bottom: var(--space-4);
  }
  .type {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: grab;
  }
  .type:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .type :global(svg) {
    color: var(--text-secondary);
  }
  .frame-shell {
    margin: 0 auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--background);
    transition: max-width 0.25s ease;
  }
  .frame-shell.phone {
    max-width: 24.5rem;
    border-radius: 2rem;
    border-width: 6px;
  }
  .frame-shell iframe {
    display: block;
    width: 100%;
    height: calc(100 * var(--vh) - var(--strip-height, 3rem) - 9rem);
    min-height: 40rem;
    border: 0;
  }
  .outline {
    display: grid;
    gap: 1px;
  }
  .ol-section,
  .ol-item {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: 0.3rem 0.5rem;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
  }
  .ol-section {
    margin-top: var(--space-2);
    color: var(--text);
    font-weight: 500;
  }
  .ol-section small {
    color: var(--text-muted);
  }
  .ol-item {
    padding-left: 1rem;
    font-size: 0.8rem;
  }
  .ol-item.off {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .ol-section:hover,
  .ol-item:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }
  .ol-section.on,
  .ol-item.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-strong, var(--text));
  }
  /* The same 12-column grid the scouting page uses, so card widths match. */
  .ds-grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: var(--space-3);
  }
  .pub {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  .pub .label {
    color: var(--text-muted);
    font-size: 0.75rem;
  }
  .pub p {
    margin: 0;
    font-size: 0.88rem;
  }
  .versions {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .versions li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .versions li.live {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }
  .versions li.builtin {
    border-style: dashed;
  }
  .versions li.none {
    color: var(--text-muted);
  }
  .v-main {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .v-main b {
    font-weight: 500;
  }
  .v-main small {
    color: var(--text-muted);
  }
  .v-main p {
    margin: 2px 0 0;
    font-size: 0.88rem;
  }
  .v-diff {
    color: var(--text-secondary) !important;
  }
  .v-actions {
    display: flex;
    gap: var(--space-1);
    align-items: flex-start;
    flex: none;
  }
  @media (max-width: 1280px) {
    .workspace {
      grid-template-columns: 11rem minmax(0, 1fr) 18rem;
    }
  }
  @media (max-width: 1000px) {
    .workspace {
      grid-template-columns: 1fr;
    }
    .palette,
    .inspector {
      position: static;
      max-height: none;
    }
    .types {
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    }
  }
</style>

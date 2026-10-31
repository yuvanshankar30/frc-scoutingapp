<script>
  import { onMount, onDestroy } from 'svelte';
  import { fade, fly, slide } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import {
    AlignLeft,
    ArrowLeft,
    ArrowRight,
    ChevronsUpDown,
    CircleDot,
    Eye,
    Hash,
    History,
    Layers,
    MousePointerClick,
    Plus,
    Redo2,
    Rocket,
    RotateCcw,
    SquareCheck,
    Star,
    ToggleLeft,
    TriangleAlert,
    Type,
    Undo2,
    X
  } from 'lucide-svelte';
  import CustomQuestions from './CustomQuestions.svelte';
  import CoreCard from './CoreCard.svelte';
  import QuestionCard from './QuestionCard.svelte';
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
    formProblems,
    newQuestionId,
    questionsIn,
    sanitizeForm,
    sectionItems
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
    AlignLeft
  };
  const SAVE_DELAY_MS = 900;

  let formType = 'match';
  let loading = true;
  let loadError = '';
  let setupNeeded = false;
  let liveVersion = 0;
  let versions = [];
  let liveForm = emptyForm();
  let hist = createHistory(emptyForm());
  let section = FORM_TYPES.match.sections[0].id;
  let expandedId = null;
  let viewing = null;
  let sideTab = 'preview';
  let adding = false;
  let note = '';
  let saveState = 'idle';
  let savedAt = null;
  let publishing = false;
  let banner = null;
  let draftNotice = '';
  let restoredFrom = null;
  let undoBar = null;
  let previewAnswers = {};
  let counts = { match: 0, pit: 0 };
  let saveTimer = null;
  let bannerTimer = null;
  let undoTimer = null;
  let reducedMotion = false;
  let dragId = null;
  let overId = null;
  let armed = null;

  $: form = hist.present;
  $: sections = FORM_TYPES[formType].sections;
  $: sectionMeta = sections.find((entry) => entry.id === section) || sections[0];
  $: problems = formProblems(form);
  $: diff = diffForms(liveForm, form, formType);
  $: viewingEntry = viewing ? versions.find((entry) => entry.version === viewing) : null;
  $: shown = viewingEntry ? viewingEntry.schema : form;
  $: items = sectionItems(shown, formType, section);
  $: viewIndex = viewingEntry ? versions.indexOf(viewingEntry) : -1;
  $: shownDiff = diffForms(liveForm, shown, formType);
  $: changedCore = new Set(shownDiff.core);
  $: changeById = new Map([
    ...shownDiff.added.map((q) => [q.id, 'added']),
    ...shownDiff.edited.map((q) => [q.id, 'edited'])
  ]);
  $: motion = !reducedMotion;
  $: dur = (ms) => (motion ? ms : 0);
  $: counts = { ...counts, [formType]: form.questions.length };

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const grouped = (questions) =>
    sections.flatMap((entry) => questions.filter((question) => question.section === entry.id));
  const without = (order, id) =>
    Object.fromEntries(
      Object.entries(order || {})
        .map(([key, ids]) => [key, ids.filter((entry) => entry !== id)])
        .filter(([, ids]) => ids.length)
    );
  const insertAfter = (ids, after, id) => {
    const next = ids.filter((entry) => entry !== id);
    const at = next.indexOf(after);
    next.splice(at < 0 ? next.length : at + 1, 0, id);
    return next;
  };
  const sectionCount = (id, source = shown) => questionsIn(source, id).length;

  function say(text, kind = 'ok', ms = 6000) {
    banner = { text, kind };
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => (banner = null), ms);
  }

  async function load(type) {
    loading = true;
    loadError = '';
    setupNeeded = false;
    viewing = null;
    expandedId = null;
    draftNotice = '';
    restoredFrom = null;
    try {
      const data = await loadAdminForm(type);
      liveVersion = data.live_version;
      versions = data.versions;
      liveForm = versions[0]?.schema || emptyForm();
      const draft = data.draft;
      hist = createHistory(draft ? draft.schema : liveForm);
      if (draft && draft.base_version !== liveVersion)
        draftNotice = `This draft was started on version ${draft.base_version || 'none'}; version ${liveVersion} has been published since. Check it before publishing.`;
      saveState = draft ? 'saved' : 'idle';
      savedAt = draft?.updated_at || null;
      section = FORM_TYPES[type].sections[0].id;
      counts = { ...counts, [type]: hist.present.questions.length };
    } catch (error) {
      loadError = error.message;
      setupNeeded = Boolean(error.data?.setup_needed);
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
    const before = hist;
    hist = pushHistory(hist, next, group);
    if (hist !== before) markDirty();
  }

  const stepHistory = (fn) => {
    const before = hist;
    hist = fn(hist);
    if (hist !== before) {
      markDirty();
      expandedId = expandedId && hist.present.questions.some((q) => q.id === expandedId) ? expandedId : null;
    }
  };
  const doUndo = () => stepHistory(undo);
  const doRedo = () => stepHistory(redo);

  function onKeydown(event) {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== (event.shiftKey ? 'z' : event.key.toLowerCase())
    )
      return;
    const typing = event.target?.closest?.('input, textarea, [contenteditable]');
    if (typing) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      doUndo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      doRedo();
    }
  }

  function addQuestion(type) {
    const question = createQuestion(type, section);
    const listed = form.order?.[section];
    commit({
      ...form,
      questions: grouped([...form.questions, question]),
      order: listed
        ? { ...form.order, [section]: [...sectionItems(form, formType, section).map((item) => item.id), question.id] }
        : form.order
    });
    expandedId = question.id;
    adding = false;
  }

  const patchQuestion = (id, changes, group) =>
    commit(
      {
        ...form,
        questions: form.questions.map((question) => (question.id === id ? { ...question, ...changes } : question))
      },
      group ? `${id}:${group}` : null
    );
  const convert = (id, type) =>
    commit({
      ...form,
      questions: form.questions.map((question) => (question.id === id ? convertQuestion(question, type) : question))
    });

  function remove(id) {
    const question = form.questions.find((entry) => entry.id === id);
    commit({ ...form, questions: form.questions.filter((entry) => entry.id !== id), order: without(form.order, id) });
    if (expandedId === id) expandedId = null;
    clearTimeout(undoTimer);
    undoBar = { label: question?.label.trim() || 'Untitled question' };
    undoTimer = setTimeout(() => (undoBar = null), 8000);
  }

  function duplicate(id) {
    const original = form.questions.find((entry) => entry.id === id);
    if (!original) return;
    const copy = {
      ...original,
      id: newQuestionId(),
      label: original.label ? `${original.label} (copy)` : '',
      options: original.options?.map((option) => ({ ...option, id: `o_${Math.random().toString(36).slice(2, 10)}` }))
    };
    if (!copy.options) delete copy.options;
    const at = form.questions.findIndex((entry) => entry.id === id);
    const next = [...form.questions];
    next.splice(at + 1, 0, copy);
    const listed = form.order?.[original.section];
    commit({
      ...form,
      questions: next,
      order: listed
        ? {
            ...form.order,
            [original.section]: insertAfter(
              sectionItems(form, formType, original.section).map((item) => item.id),
              id,
              copy.id
            )
          }
        : form.order
    });
    expandedId = copy.id;
  }

  const itemIds = () => sectionItems(form, formType, section).map((item) => item.id);
  const withOrder = (ids) => ({ ...form, order: { ...form.order, [section]: ids } });

  function move(id, direction) {
    const ids = itemIds();
    const at = ids.indexOf(id);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= ids.length) return;
    [ids[at], ids[to]] = [ids[to], ids[at]];
    commit(withOrder(ids));
  }

  function moveToSection(id, target) {
    const base = {
      ...form,
      questions: grouped(
        form.questions.map((question) => (question.id === id ? { ...question, section: target } : question))
      ),
      order: without(form.order, id)
    };
    const listed = form.order?.[target];
    commit(
      listed
        ? {
            ...base,
            order: { ...base.order, [target]: [...sectionItems(form, formType, target).map((item) => item.id), id] }
          }
        : base
    );
    section = target;
  }

  function patchCore(key, changes, group) {
    const entry = coreBlocksIn(formType, section).find((candidate) => candidate.key === key);
    const merged = { ...(form.core?.[key] || {}), ...changes };
    if (merged.label !== undefined && (!merged.label.trim() || merged.label === entry.label)) delete merged.label;
    if (merged.help !== undefined && merged.help === entry.help) delete merged.help;
    if (!merged.hidden) delete merged.hidden;
    const core = { ...(form.core || {}) };
    if (Object.keys(merged).length) core[key] = merged;
    else delete core[key];
    commit({ ...form, core }, group ? `${key}:${group}` : null);
  }

  function resetCore(key) {
    const core = { ...(form.core || {}) };
    delete core[key];
    commit({ ...form, core });
  }

  const dragStart = (event, id) => {
    dragId = id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };
  const dragOver = (event, id) => {
    if (!dragId || dragId === id) return;
    event.preventDefault();
    overId = id;
  };
  function drop(event, id) {
    event.preventDefault();
    if (!dragId || dragId === id) return;
    const ids = itemIds().filter((entry) => entry !== dragId);
    ids.splice(ids.indexOf(id), 0, dragId);
    commit(withOrder(ids));
    dragId = overId = armed = null;
  }

  async function switchForm(type) {
    if (type === formType || loading) return;
    await flushSave();
    formType = type;
    await load(type);
  }

  function restore(entry) {
    commit(sanitizeForm(JSON.parse(JSON.stringify(entry.schema)), formType));
    restoredFrom = entry.version;
    viewing = null;
    sideTab = 'preview';
    say(
      `Version ${entry.version} is loaded into your draft. Review it, then publish to make it live. Undo brings your previous draft back.`
    );
  }

  function stepVersion(direction) {
    const next = versions[viewIndex + direction];
    if (next) viewing = next.version;
  }

  async function discard() {
    const ok = await requestConfirmation({
      title: 'Discard your draft?',
      message: `Your unpublished changes to the ${FORM_TYPES[formType].label.toLowerCase()} form are deleted and the draft goes back to version ${liveVersion || 'the built-in form'}.`,
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
    draftNotice = '';
    restoredFrom = null;
    say('Draft discarded.');
  }

  async function publish() {
    const keys = Object.keys(problems);
    if (keys.length) {
      const first = form.questions.find((question) => problems[question.id]);
      section = first.section;
      expandedId = first.id;
      say(
        `Fix the ${keys.length === 1 ? 'highlighted question' : `${keys.length} highlighted questions`} before publishing.`,
        'error'
      );
      return;
    }
    if (!diff.changed) {
      say('There is nothing new to publish.', 'error');
      return;
    }
    const next = liveVersion + 1;
    const ok = await requestConfirmation({
      title: `Publish version ${next}?`,
      message: `This becomes the live ${FORM_TYPES[formType].label.toLowerCase()} form: ${describeDiff(diff).toLowerCase()}.\n\nScouts get it the next time they open the form. Reports already submitted keep the version they were answered with, and you can bring back any older version from History.`,
      confirmLabel: `Publish version ${next}`
    });
    if (!ok) return;
    publishing = true;
    try {
      await flushSave();
      const source = restoredFrom ? versions.find((entry) => entry.version === restoredFrom) : null;
      await publishForm(
        formType,
        form,
        liveVersion,
        note,
        source && !diffForms(source.schema, form, formType).changed ? restoredFrom : null
      );
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

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    load(formType);
    loadOther();
  });
  onDestroy(() => {
    clearTimeout(bannerTimer);
    clearTimeout(undoTimer);
    if (saveState === 'dirty') flushSave();
  });

  // The other form's question count, for its switcher tab.
  async function loadOther() {
    const other = formType === 'match' ? 'pit' : 'match';
    try {
      const data = await loadAdminForm(other);
      counts = { ...counts, [other]: (data.draft?.schema || data.versions[0]?.schema || emptyForm()).questions.length };
    } catch {
      /* the tab just shows no count */
    }
  }

  $: saveLabel = {
    idle: viewing ? '' : 'No draft yet',
    dirty: 'Unsaved changes',
    saving: 'Saving draft…',
    saved: savedAt ? `Draft saved ${fmt(savedAt)}` : 'Draft saved',
    error: 'Could not save the draft'
  }[saveState];
</script>

<svelte:window
  on:keydown={onKeydown}
  on:beforeunload={(event) => {
    if (saveState === 'dirty' || saveState === 'saving') {
      event.preventDefault();
      event.returnValue = '';
    }
  }}
/>

<div class="fe">
  <header class="fe-top">
    <div class="fe-switch" role="tablist" aria-label="Which form">
      {#each Object.entries(FORM_TYPES) as [type, info]}
        <button
          type="button"
          role="tab"
          aria-selected={formType === type}
          class:on={formType === type}
          on:click={() => switchForm(type)}
        >
          {info.label}{#if counts[type]}<b>{counts[type]}</b>{/if}
        </button>
      {/each}
    </div>
    <div class="fe-status">
      <span class="fe-live">{liveVersion ? `Scouts see version ${liveVersion}` : 'Scouts see the built-in form'}</span>
      {#if diff.changed}<span class="fe-unpub" transition:fade={{ duration: dur(150) }}
          >{describeDiff(diff)} · not published</span
        >{/if}
      {#if saveLabel}<span
          class="fe-save"
          class:err={saveState === 'error'}
          class:busy={saveState === 'saving' || saveState === 'dirty'}>{saveLabel}</span
        >{/if}
    </div>
    <div class="fe-actions">
      <button
        type="button"
        class="btn btn-outline btn-sm"
        disabled={!canUndo(hist) || !!viewing}
        on:click={doUndo}
        title="Undo (Ctrl or ⌘ + Z)"><Undo2 size={15} /> Undo</button
      >
      <button
        type="button"
        class="btn btn-outline btn-sm"
        disabled={!canRedo(hist) || !!viewing}
        on:click={doRedo}
        title="Redo (Shift + Ctrl or ⌘ + Z)"><Redo2 size={15} /> Redo</button
      >
      <button
        type="button"
        class="btn btn-outline btn-sm"
        class:active={sideTab === 'history'}
        on:click={() => (sideTab = sideTab === 'history' ? 'preview' : 'history')}><History size={15} /> History</button
      >
      <button
        type="button"
        class="btn btn-outline btn-sm"
        disabled={saveState === 'idle' && !diff.changed}
        on:click={discard}><RotateCcw size={15} /> Discard draft</button
      >
      <button type="button" class="btn btn-primary" disabled={publishing || !!viewing || loading} on:click={publish}
        ><Rocket size={15} /> {publishing ? 'Publishing…' : 'Publish'}</button
      >
    </div>
  </header>

  {#if banner}
    <div
      class="fe-banner {banner.kind}"
      role={banner.kind === 'error' ? 'alert' : 'status'}
      transition:slide={{ duration: dur(160) }}
    >
      <span>{banner.text}</span><button type="button" aria-label="Dismiss" on:click={() => (banner = null)}
        ><X size={14} /></button
      >
    </div>
  {/if}
  {#if draftNotice}<div class="fe-banner warn" role="status">
      <TriangleAlert size={15} /><span>{draftNotice}</span>
    </div>{/if}

  {#if loading}
    <div class="fe-state" role="status">Loading the form…</div>
  {:else if loadError}
    <div class="fe-state error" role="alert">
      <b>{setupNeeded ? 'Form editing needs a database update first.' : 'Could not load the form.'}</b>
      <span
        >{setupNeeded
          ? 'The forms tables are not in the database yet. Apply the latest migration, then reload.'
          : loadError}</span
      >
      <button type="button" class="btn btn-outline btn-sm" on:click={() => load(formType)}>Try again</button>
    </div>
  {:else}
    <div class="fe-grid">
      <div class="fe-main">
        {#if viewingEntry}
          <div class="fe-viewing" transition:slide={{ duration: dur(160) }}>
            <div>
              <b><Eye size={15} /> Viewing version {viewingEntry.version}{viewIndex === 0 ? ' (live)' : ''}</b>
              <small
                >Read only. {viewingEntry.published_by ? `Published by ${viewingEntry.published_by} · ` : ''}{fmt(
                  viewingEntry.published_at
                )}{viewingEntry.note ? ` · “${viewingEntry.note}”` : ''}</small
              >
            </div>
            <div class="fe-viewing-actions">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                disabled={viewIndex >= versions.length - 1}
                on:click={() => stepVersion(1)}><ArrowLeft size={14} /> Older</button
              >
              <button
                type="button"
                class="btn btn-outline btn-sm"
                disabled={viewIndex <= 0}
                on:click={() => stepVersion(-1)}>Newer <ArrowRight size={14} /></button
              >
              <button type="button" class="btn btn-outline btn-sm" on:click={() => (viewing = null)}
                >Back to my draft</button
              >
              <button type="button" class="btn btn-primary btn-sm" on:click={() => restore(viewingEntry)}
                >Use this version as my draft</button
              >
            </div>
          </div>
        {/if}

        <nav class="fe-sections" aria-label="Form sections">
          {#each sections as entry (entry.id)}
            <button
              type="button"
              class:on={section === entry.id}
              aria-current={section === entry.id ? 'true' : undefined}
              on:click={() => {
                section = entry.id;
                expandedId = null;
                adding = false;
              }}
            >
              {entry.label}<b>{sectionCount(entry.id)}</b>
            </button>
          {/each}
        </nav>

        <div class="fe-list" role="list">
          {#each items as item, index (item.id)}
            <div
              class="fe-row"
              role="listitem"
              class:dragging={dragId === item.id}
              class:over={overId === item.id}
              draggable={!viewing && armed === item.id}
              animate:flip={{ duration: dur(220) }}
              in:fly={{ y: 12, duration: dur(200) }}
              out:fade={{ duration: dur(120) }}
              on:pointerdown={(event) => (armed = event.target.closest('.qc-grip') ? item.id : null)}
              on:dragstart={(event) => dragStart(event, item.id)}
              on:dragover={(event) => dragOver(event, item.id)}
              on:drop={(event) => drop(event, item.id)}
              on:dragend={() => {
                dragId = overId = armed = null;
              }}
            >
              {#if item.kind === 'core'}
                <CoreCard
                  {item}
                  {index}
                  count={items.length}
                  expanded={expandedId === item.id}
                  readonly={!!viewing}
                  change={changedCore.has(item.block.key)}
                  {motion}
                  on:toggle={() => (expandedId = expandedId === item.id ? null : item.id)}
                  on:patch={(event) => patchCore(item.block.key, event.detail.changes, event.detail.group)}
                  on:reset={() => resetCore(item.block.key)}
                  on:move={(event) => move(item.id, event.detail)}
                />
              {:else}
                <QuestionCard
                  question={item.question}
                  {index}
                  count={items.length}
                  expanded={expandedId === item.id}
                  problems={viewing ? [] : problems[item.id] || []}
                  readonly={!!viewing}
                  change={changeById.get(item.id) || null}
                  {motion}
                  {sections}
                  on:toggle={() => (expandedId = expandedId === item.id ? null : item.id)}
                  on:patch={(event) => patchQuestion(item.id, event.detail.changes, event.detail.group)}
                  on:convert={(event) => convert(item.id, event.detail)}
                  on:remove={() => remove(item.id)}
                  on:duplicate={() => duplicate(item.id)}
                  on:move={(event) => move(item.id, event.detail)}
                  on:section={(event) => moveToSection(item.id, event.detail)}
                />
              {/if}
            </div>
          {:else}
            <div class="fe-empty" in:fade={{ duration: dur(150) }}>
              <b>Nothing in {sectionMeta.label}</b>
              <span
                >{viewing
                  ? 'This version added none here.'
                  : 'Scouts see only the built-in questions here. Add one to ask something extra.'}</span
              >
            </div>
          {/each}
        </div>

        {#if !viewing}
          <div class="fe-add">
            <button type="button" class="btn btn-primary" aria-expanded={adding} on:click={() => (adding = !adding)}
              ><Plus size={16} /> Add a question</button
            >
            <span class="fe-hint">to {sectionMeta.label}</span>
          </div>
          {#if adding}
            <div class="fe-types" transition:slide={{ duration: dur(180) }}>
              {#each Object.entries(QUESTION_TYPES) as [type, info]}
                <button type="button" on:click={() => addQuestion(type)}>
                  <span class="t-icon"><svelte:component this={ICONS[info.icon]} size={18} /></span>
                  <b>{info.label}</b><small>{info.blurb}</small>
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

      <aside class="fe-side" aria-label="Preview and history">
        <div class="fe-side-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'preview'}
            class:on={sideTab === 'preview'}
            on:click={() => (sideTab = 'preview')}>Preview</button
          >
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'history'}
            class:on={sideTab === 'history'}
            on:click={() => (sideTab = 'history')}>History <b>{versions.length}</b></button
          >
        </div>
        {#if sideTab === 'preview'}
          <div class="fe-preview" in:fade={{ duration: dur(140) }}>
            <p class="fe-preview-note">
              The order a scout sees in <b>{sectionMeta.label}</b>. Built-in questions show as grey bars; try your own;
              nothing is saved.
            </p>
            <div class="fe-preview-list">
              {#each items.filter((item) => item.kind === 'custom' || !item.view.hidden) as item (item.id)}
                <div animate:flip={{ duration: dur(200) }}>
                  {#if item.kind === 'core'}
                    <div class="fe-ph"><Layers size={14} /><span>{item.view.label}</span><small>built-in</small></div>
                  {:else}
                    <CustomQuestions questions={[item.question]} bind:answers={previewAnswers} />
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {:else}
          <div class="fe-history" in:fade={{ duration: dur(140) }}>
            <label class="fe-note">
              <span>Note for the next version <em>optional</em></span>
              <input
                class="form-input"
                type="text"
                maxlength="300"
                bind:value={note}
                placeholder="What changed, for the history"
              />
            </label>
            <ol>
              <li class="fe-version draft" class:viewing={!viewing}>
                <button type="button" on:click={() => (viewing = null)}>
                  <b>Your draft</b><small>{diff.changed ? describeDiff(diff) : 'Same as live'}</small>
                </button>
              </li>
              {#each versions as entry, position (entry.version)}
                {@const previous = versions[position + 1]?.schema || emptyForm()}
                <li class="fe-version" class:viewing={viewing === entry.version} animate:flip={{ duration: dur(200) }}>
                  <button type="button" on:click={() => (viewing = entry.version)}>
                    <span class="fe-v"
                      ><b>Version {entry.version}</b>{#if position === 0}<i>Live</i>{/if}{#if entry.restored_from}<em
                          >from v{entry.restored_from}</em
                        >{/if}</span
                    >
                    <small>{describeDiff(diffForms(previous, entry.schema, formType))}</small>
                    {#if entry.note}<q>{entry.note}</q>{/if}
                    <small class="when">{entry.published_by || 'Someone'} · {fmt(entry.published_at)}</small>
                  </button>
                </li>
              {:else}
                <li class="fe-muted">Nothing has been published yet. Scouts see the built-in form.</li>
              {/each}
            </ol>
          </div>
        {/if}
      </aside>
    </div>
  {/if}

  {#if undoBar}
    <div class="fe-undo" role="status" transition:fly={{ y: 20, duration: dur(180) }}>
      <span>Deleted “{undoBar.label}”</span>
      <button
        type="button"
        on:click={() => {
          doUndo();
          undoBar = null;
        }}>Undo</button
      >
    </div>
  {/if}
</div>

<style>
  .fe {
    display: grid;
    gap: var(--space-4);
  }
  .fe-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    background: var(--surface-1);
    position: sticky;
    top: var(--strip-height, 3.5rem);
    z-index: 4;
  }
  .fe-switch {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .fe-switch button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.95rem;
    border: 0;
    background: var(--surface-2);
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 0.14s ease,
      color 0.14s ease;
  }
  .fe-switch button + button {
    border-left: 1px solid var(--border);
  }
  .fe-switch button.on {
    background: var(--brand-gold-soft);
    color: var(--text);
    box-shadow: inset 0 -3px 0 var(--brand-gold-strong);
  }
  .fe-switch b,
  .fe-sections b,
  .fe-side-tabs b {
    min-width: 1.3rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--surface-1);
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    text-align: center;
  }
  .fe-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.9rem;
    flex: 1;
    min-width: 12rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .fe-live {
    padding: 0.1rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text);
    font-weight: 600;
  }
  .fe-unpub {
    color: var(--brand-gold-strong);
    font-weight: 600;
  }
  .fe-save.busy {
    opacity: 0.75;
  }
  .fe-save.err {
    color: var(--red-base);
    font-weight: 600;
  }
  .fe-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-left: auto;
  }
  .fe-actions :global(.btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .fe-actions :global(.btn.active) {
    border-color: var(--brand-gold-strong);
  }

  .fe-banner {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.65rem 0.9rem;
    border-left: 3px solid var(--brand-gold-strong);
    background: var(--brand-gold-soft);
    color: var(--text);
    font-size: 0.88rem;
  }
  .fe-banner span {
    flex: 1;
  }
  .fe-banner button {
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    display: grid;
  }
  .fe-banner.error {
    border-color: var(--red-base);
    background: var(--red-soft);
  }
  .fe-banner.warn :global(svg) {
    color: var(--brand-gold-strong);
    flex: none;
  }
  .fe-state {
    display: grid;
    gap: var(--space-2);
    justify-items: start;
    padding: var(--space-6) var(--space-5);
    border: 1px dashed var(--border);
    color: var(--text-muted);
  }
  .fe-state.error {
    border-color: var(--red-base);
  }
  .fe-state b {
    color: var(--text);
  }

  .fe-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 25rem);
    gap: var(--space-5);
    align-items: start;
  }
  .fe-main {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .fe-viewing {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--brand-gold-strong);
    background: var(--brand-gold-soft);
  }
  .fe-viewing b {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .fe-viewing small {
    display: block;
    margin-top: 2px;
    color: var(--text-secondary);
  }
  .fe-viewing-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .fe-sections {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    border-bottom: 1px solid var(--border);
  }
  .fe-sections button {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.6rem 0.95rem;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      color 0.14s ease,
      border-color 0.14s ease;
  }
  .fe-sections button:hover {
    color: var(--text);
  }
  .fe-sections button.on {
    color: var(--text);
    border-bottom-color: var(--brand-gold-strong);
  }
  .fe-preview-list {
    display: grid;
    gap: 0;
  }
  .fe-ph {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: var(--space-2);
    padding: 0.55rem 0.8rem;
    border: 1px dashed var(--border);
    background: var(--surface-2);
    color: var(--text-secondary);
    font-size: 0.82rem;
  }
  .fe-ph small {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 0.66rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .fe-list {
    display: grid;
    gap: var(--space-2);
  }
  .fe-row {
    transition: opacity 0.14s ease;
  }
  .fe-row.dragging {
    opacity: 0.4;
  }
  .fe-row.over {
    box-shadow: 0 -3px 0 var(--brand-gold-strong);
  }
  .fe-empty {
    display: grid;
    gap: 0.25rem;
    justify-items: center;
    padding: var(--space-6) var(--space-4);
    border: 1px dashed var(--border);
    color: var(--text-muted);
    text-align: center;
  }
  .fe-empty b {
    color: var(--text);
  }
  .fe-add {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .fe-add :global(.btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .fe-hint {
    color: var(--text-muted);
    font-size: 0.82rem;
  }
  .fe-types {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: var(--space-2);
  }
  .fe-types button {
    display: grid;
    gap: 0.2rem;
    justify-items: start;
    padding: var(--space-3);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.14s ease,
      transform 0.14s ease,
      background-color 0.14s ease;
  }
  .fe-types button:hover {
    border-color: var(--brand-gold-strong);
    background: var(--surface-1);
    transform: translateY(-2px);
  }
  .fe-types .t-icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm);
    background: var(--surface-1);
    color: var(--brand-gold-strong);
  }
  .fe-types small {
    color: var(--text-muted);
    font-size: 0.74rem;
    line-height: 1.3;
  }

  .fe-side {
    position: sticky;
    top: calc(var(--strip-height, 3.5rem) + 5.5rem);
    display: grid;
    border: 1px solid var(--border);
    background: var(--surface-1);
    max-height: calc(100vh - var(--strip-height, 3.5rem) - 7rem);
    overflow: hidden;
  }
  .fe-side-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .fe-side-tabs button {
    flex: 1;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    gap: 0.4rem;
    padding: 0.65rem;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .fe-side-tabs button.on {
    color: var(--text);
    border-bottom-color: var(--brand-gold-strong);
  }
  .fe-preview,
  .fe-history {
    padding: var(--space-4);
    overflow-y: auto;
    min-height: 0;
  }
  .fe-preview-note {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }
  .fe-muted {
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .fe-preview :global(.cq:first-of-type) {
    margin-top: var(--space-3);
  }
  .fe-note {
    display: grid;
    gap: 0.3rem;
    margin-bottom: var(--space-3);
  }
  .fe-note span {
    color: var(--text-muted);
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .fe-note em {
    text-transform: none;
    letter-spacing: 0;
    font-style: normal;
    opacity: 0.75;
  }
  .fe-history ol {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fe-version button {
    display: grid;
    gap: 0.2rem;
    width: 100%;
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--border);
    border-left-width: 3px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.14s ease,
      background-color 0.14s ease;
  }
  .fe-version button:hover {
    border-color: var(--brand-gold-strong);
  }
  .fe-version.viewing button {
    border-color: var(--brand-gold-strong);
    background: var(--brand-gold-soft);
  }
  .fe-v {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .fe-v i {
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--brand-gold-strong);
    color: var(--surface-1);
    font-size: 0.66rem;
    font-style: normal;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .fe-v em {
    color: var(--text-muted);
    font-size: 0.72rem;
    font-style: normal;
  }
  .fe-version small {
    color: var(--text-secondary);
    font-size: 0.78rem;
  }
  .fe-version small.when {
    color: var(--text-muted);
  }
  .fe-version q {
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-style: italic;
    quotes: none;
  }
  .fe-undo {
    position: fixed;
    left: 50%;
    bottom: 1.5rem;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0.65rem 1rem;
    transform: translateX(-50%);
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--shadow-pop);
    font-size: 0.88rem;
  }
  .fe-undo button {
    border: 0;
    background: none;
    color: var(--brand-gold-strong);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  @media (max-width: 1100px) {
    .fe-grid {
      grid-template-columns: 1fr;
    }
    .fe-side {
      position: static;
      max-height: none;
    }
    .fe-top {
      position: static;
    }
  }
  @media (max-width: 640px) {
    .fe-actions {
      margin-left: 0;
      width: 100%;
    }
    .fe-actions :global(.btn) {
      flex: 1 1 auto;
      justify-content: center;
    }
    .fe-undo {
      width: calc(100% - 2rem);
      justify-content: space-between;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fe * {
      transition: none !important;
    }
  }
</style>

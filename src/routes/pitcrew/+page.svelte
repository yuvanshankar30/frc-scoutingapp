<script>
  import { todayInAppTimeZone } from '$lib/app/timezone.js';
  // Pit Crew: log your own robot's failures during drive practice and matches, mark them resolved once they
  // are fixed, and validate the fix. The robot_tickets table backs it.
  import { onMount } from 'svelte';
  import { supabase } from '$lib/app/supabase.js';
  import Select from '$lib/components/common/Select.svelte';
  import DatePicker from '$lib/components/common/DatePicker.svelte';
  import { Wrench, CheckCircle2 } from 'lucide-svelte';
  import BottomSheet from '$lib/components/common/BottomSheet.svelte';
  import { isPhone } from '$lib/stores/device.js';
  import { ourTeamKey } from '$lib/stores/team.js';

  const OWNERS = [
    { value: 'mechanical', label: 'Mechanical' },
    { value: 'electrical', label: 'Electrical' },
    { value: 'software', label: 'Software' },
    { value: 'pit_crew', label: 'Pit Crew' }
  ];
  const SEVERITIES = [
    { value: 'match_ending', label: 'Match-ending' },
    { value: 'severe', label: 'Severe' },
    { value: 'minor', label: 'Minor' }
  ];
  const SEVERITY_SHORT = { match_ending: 'Match-ending', severe: 'Severe', minor: 'Minor' };
  const SEVERITY_HINT = {
    match_ending: 'Robot disabled or unable to score the rest of the match.',
    severe: 'Functional but significantly degraded, or needs repair before the next match.',
    minor: 'Cosmetic or low-impact, can wait until after the event.'
  };
  const OWNER_LABEL = Object.fromEntries(OWNERS.map((o) => [o.value, o.label]));

  const today = todayInAppTimeZone();
  const emptyForm = () => ({
    subsystem_owner: 'mechanical',
    severity: 'severe',
    occurred_on: today,
    context_type: 'match',
    context_detail: '',
    short_term_fix: '',
    short_term_fix_minutes: '',
    suspected_root_cause: '',
    is_repeat: false
  });

  const OWNER_OTHER = '__other__';
  let form = emptyForm();
  let ownerCustom = ''; // free text when the owner Select is on "Other…"
  let saving = false;
  let errorMsg = '';
  let successMsg = '';
  // Phones open the log form in a bottom sheet from a docked button.
  let logOpen = false;

  let resolved = [];
  let loadingResolved = false;
  let validatingId = null;

  async function currentUserId() {
    try {
      const { data } = await supabase.auth.getUser();
      return data?.user?.id || null;
    } catch {
      return null;
    }
  }

  // Open tickets (logged, not fixed yet) and resolved ones (fixed, waiting for the pit crew to check), in one read.
  let open = [];
  let resolvingId = null;
  async function loadResolved() {
    loadingResolved = true;
    try {
      const { data, error } = await supabase
        .from('robot_tickets')
        .select('*')
        .in('status', ['open', 'triaged', 'resolved'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      open = rows.filter((t) => t.status !== 'resolved');
      resolved = rows.filter((t) => t.status === 'resolved');
    } catch (cause) {
      errorMsg = cause?.message || 'Could not load resolved issues.';
    } finally {
      loadingResolved = false;
    }
  }

  onMount(loadResolved);

  async function createTicket() {
    errorMsg = '';
    successMsg = '';
    const owner = form.subsystem_owner === OWNER_OTHER ? ownerCustom.trim() : form.subsystem_owner;
    if (!owner || !form.severity || !form.occurred_on || !form.context_type) {
      errorMsg = 'Fill in the subsystem/owner, severity, date and where it happened.';
      return;
    }
    saving = true;
    try {
      const minutes = String(form.short_term_fix_minutes).trim();
      const row = {
        subsystem_owner: owner,
        severity: form.severity,
        occurred_on: form.occurred_on,
        context_type: form.context_type,
        context_detail: form.context_detail.trim() || null,
        short_term_fix: form.short_term_fix.trim() || null,
        short_term_fix_minutes:
          minutes && Number.isFinite(Number(minutes)) ? Math.max(0, Math.round(Number(minutes))) : null,
        suspected_root_cause: form.suspected_root_cause.trim() || null,
        is_repeat: !!form.is_repeat,
        status: 'open',
        team_key: $ourTeamKey || null,
        created_by: await currentUserId()
      };
      const { error } = await supabase.from('robot_tickets').insert(row);
      if (error) throw error;
      successMsg = 'Ticket logged. Mark it fixed once the robot is repaired.';
      void loadResolved();
      logOpen = false;
      form = emptyForm();
      ownerCustom = '';
    } catch (cause) {
      errorMsg = cause?.message || 'Could not log the ticket.';
    } finally {
      saving = false;
    }
  }

  async function markFixed(ticket) {
    errorMsg = '';
    successMsg = '';
    resolvingId = ticket.id;
    try {
      const { error } = await supabase
        .from('robot_tickets')
        .update({ status: 'resolved', resolved_by: await currentUserId(), resolved_at: new Date().toISOString() })
        .eq('id', ticket.id);
      if (error) throw error;
      open = open.filter((t) => t.id !== ticket.id);
      resolved = [{ ...ticket, status: 'resolved' }, ...resolved];
      successMsg = 'Marked fixed. Validate it once you have checked the fix on the robot.';
    } catch (cause) {
      errorMsg = cause?.message || 'Could not update the ticket.';
    } finally {
      resolvingId = null;
    }
  }

  async function validate(ticket) {
    errorMsg = '';
    successMsg = '';
    validatingId = ticket.id;
    try {
      const { error } = await supabase
        .from('robot_tickets')
        .update({ status: 'validated', validated_by: await currentUserId(), validated_at: new Date().toISOString() })
        .eq('id', ticket.id);
      if (error) throw error;
      resolved = resolved.filter((t) => t.id !== ticket.id);
      successMsg = 'Validated.';
    } catch (cause) {
      errorMsg = cause?.message || 'Could not validate the issue.';
    } finally {
      validatingId = null;
    }
  }

  function whenText(t) {
    const where = t.context_type === 'drive_practice' ? 'Drive practice' : 'Match';
    const detail = t.context_detail ? ` ${t.context_detail}` : '';
    return `${t.occurred_on} · ${where}${detail}`;
  }
</script>

<svelte:head><title>Pit Crew</title></svelte:head>

<div class="pitcrew">
  <div class="page-head">
    <h1><Wrench size={20} /> Pit Crew</h1>
    <p class="sp-lede">
      Log your robot's failures at drive practice and competition, mark them fixed once they are repaired, then validate
      the fix on the robot.
    </p>
  </div>

  {#if errorMsg}<div class="status-message status-error" role="alert">{errorMsg}</div>{/if}
  {#if successMsg}<div class="status-message status-success" role="status">{successMsg}</div>{/if}

  {#if $isPhone}
    {@render resolvedList()}
    {@render openList()}
    <button type="button" class="pc-dock btn btn-primary" on:click={() => (logOpen = true)}
      ><Wrench size={18} /> Log a failure</button
    >
    <BottomSheet
      open={logOpen}
      title="Log a failure"
      subtitle="What broke, how bad, and what pit did"
      on:close={() => (logOpen = false)}
    >
      {@render logForm()}
    </BottomSheet>
  {:else}
    <div class="pc-columns">
      {@render logForm()}
      <div class="pc-stack">
        {@render resolvedList()}
        {@render openList()}
      </div>
    </div>
  {/if}
</div>

{#snippet logForm()}
  <section class="sp-panel">
    <header>
      <h3>Log a failure</h3>
      <p>What broke, how bad, and what pit did to get the robot running.</p>
    </header>

    <form class="pc-form" on:submit|preventDefault={createTicket}>
      <div class="pc-grid">
        <label class="pc-field">
          <span>Subsystem / owner</span>
          <Select bind:value={form.subsystem_owner} aria-label="Subsystem or owner">
            {#each OWNERS as o}<option value={o.value}>{o.label}</option>{/each}
            <option value={OWNER_OTHER}>Other…</option>
          </Select>
          {#if form.subsystem_owner === OWNER_OTHER}
            <input
              class="sp-input pc-other"
              type="text"
              bind:value={ownerCustom}
              maxlength="60"
              placeholder="Type the subsystem or owner"
            />
          {/if}
        </label>

        <label class="pc-field">
          <span>Severity</span>
          <Select bind:value={form.severity} aria-label="Severity">
            {#each SEVERITIES as s}<option value={s.value}>{s.label}</option>{/each}
          </Select>
          <small class="pc-hint">{SEVERITY_HINT[form.severity]}</small>
        </label>

        <label class="pc-field">
          <span>When</span>
          <DatePicker bind:value={form.occurred_on} />
        </label>

        <label class="pc-field">
          <span>Where</span>
          <Select bind:value={form.context_type} aria-label="Drive practice or match">
            <option value="match">Match</option>
            <option value="drive_practice">Drive practice</option>
          </Select>
        </label>

        <label class="pc-field pc-span">
          <span
            >{form.context_type === 'match' ? 'Match number' : 'Practice note'} <em class="pc-opt">(optional)</em></span
          >
          <input
            class="sp-input"
            type="text"
            bind:value={form.context_detail}
            maxlength="80"
            placeholder={form.context_type === 'match' ? 'e.g. Q42' : 'e.g. Thursday scrimmage'}
          />
        </label>

        <label class="pc-field pc-span">
          <span>Short-term fix <em class="pc-opt">(what pit did to get it running)</em></span>
          <textarea class="sp-input" rows="2" bind:value={form.short_term_fix} maxlength="1000"></textarea>
        </label>

        <label class="pc-field">
          <span>Fix time (minutes) <em class="pc-opt">(optional)</em></span>
          <input
            class="sp-input"
            type="number"
            min="0"
            max="600"
            bind:value={form.short_term_fix_minutes}
            placeholder="e.g. 8"
          />
        </label>

        <label class="pc-field pc-repeat">
          <span class="pc-spacer" aria-hidden="true"></span>
          <span class="pc-check"
            ><input type="checkbox" bind:checked={form.is_repeat} /> This failure has happened before</span
          >
        </label>

        <label class="pc-field pc-span">
          <span>Suspected root cause <em class="pc-opt">(optional)</em></span>
          <textarea class="sp-input" rows="2" bind:value={form.suspected_root_cause} maxlength="1000"></textarea>
        </label>
      </div>

      <div class="pc-actions">
        <button class="btn btn-primary" type="submit" disabled={saving}>
          <Wrench size={16} />{saving ? 'Logging…' : 'Log ticket'}
        </button>
      </div>
    </form>
  </section>
{/snippet}

{#snippet openList()}
  <section class="sp-panel">
    <header>
      <h3>Open issues</h3>
      <p>Logged and not fixed yet. Mark one fixed once the robot has been repaired.</p>
    </header>
    {#if loadingResolved}
      <p class="pc-empty">Loading…</p>
    {:else if !open.length}
      <p class="pc-empty">No open issues.</p>
    {:else}
      <ul class="pc-list">
        {#each open as t (t.id)}
          <li class="pc-row">
            <div class="pc-row-main">
              <div class="pc-row-top">
                <span class="pc-sev pc-sev-{t.severity}">{SEVERITY_SHORT[t.severity] || t.severity}</span>
                <span class="pc-owner">{OWNER_LABEL[t.subsystem_owner] || t.subsystem_owner}</span>
                <span class="pc-when">{whenText(t)}</span>
              </div>
              {#if t.short_term_fix}<p class="pc-detail"><strong>Pit fix:</strong> {t.short_term_fix}</p>{/if}
              {#if t.suspected_root_cause}<p class="pc-detail pc-muted">
                  <strong>Suspected cause:</strong>
                  {t.suspected_root_cause}
                </p>{/if}
            </div>
            <button
              class="btn btn-outline btn-sm"
              type="button"
              disabled={resolvingId === t.id}
              on:click={() => markFixed(t)}
            >
              {resolvingId === t.id ? 'Saving…' : 'Mark fixed'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/snippet}

{#snippet resolvedList()}
  <section class="sp-panel">
    <header>
      <h3>Resolved — ready to validate</h3>
      <p>Issues marked fixed. Validate once you've confirmed the fix on the robot.</p>
    </header>

    {#if loadingResolved}
      <p class="pc-empty">Loading…</p>
    {:else if !resolved.length}
      <p class="pc-empty">Nothing waiting. Issues marked fixed show up here.</p>
    {:else}
      <ul class="pc-list">
        {#each resolved as t (t.id)}
          <li class="pc-row">
            <div class="pc-row-main">
              <div class="pc-row-top">
                <span class="pc-sev pc-sev-{t.severity}">{SEVERITY_SHORT[t.severity] || t.severity}</span>
                <span class="pc-owner">{OWNER_LABEL[t.subsystem_owner] || t.subsystem_owner}</span>
                <span class="pc-when">{whenText(t)}</span>
              </div>
              {#if t.long_term_fix}<p class="pc-detail"><strong>Long-term fix:</strong> {t.long_term_fix}</p>{/if}
              {#if t.suspected_root_cause}<p class="pc-detail pc-muted">
                  <strong>Suspected cause:</strong>
                  {t.suspected_root_cause}
                </p>{/if}
            </div>
            <button
              class="btn btn-primary btn-sm"
              type="button"
              disabled={validatingId === t.id}
              on:click={() => validate(t)}
            >
              <CheckCircle2 size={15} />{validatingId === t.id ? 'Validating…' : 'Validate'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/snippet}

<style>
  .pc-stack {
    display: grid;
    gap: 1.25rem;
    align-content: start;
    min-width: 0;
  }
  .pitcrew {
    display: grid;
    gap: 1.25rem;
    max-width: 78rem;
    margin: 0 auto;
    padding-bottom: 2rem;
  }
  .page-head h1 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.25rem;
  }
  .pc-form {
    display: grid;
    gap: 1rem;
  }
  .pc-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.1rem 1.5rem;
  }
  .pc-field {
    display: grid;
    gap: 0.35rem;
    align-content: start;
  }
  .pc-field > span {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
  }
  .pc-opt {
    font-style: normal;
    font-weight: 400;
    color: var(--text-secondary);
  }
  .pc-span {
    grid-column: 1 / -1;
  }
  .pc-hint {
    color: var(--text-secondary);
    font-size: 0.8rem;
  }
  .pc-other {
    margin-top: 0.1rem;
  }
  .pc-spacer {
    height: 1.1rem;
  }
  .pc-check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    font-weight: 500;
  }
  textarea.sp-input {
    resize: vertical;
    font: inherit;
  }
  .pc-actions {
    display: flex;
  }
  .pc-empty {
    color: var(--text-secondary);
  }
  .pc-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  .pc-row {
    display: flex;
    gap: 1rem;
    align-items: start;
    justify-content: space-between;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 8px);
    background: var(--surface);
  }
  .pc-row-main {
    display: grid;
    gap: 0.35rem;
  }
  .pc-row-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .pc-sev {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }
  .pc-sev-match_ending {
    background: color-mix(in srgb, var(--danger) 20%, transparent);
    color: var(--danger);
  }
  .pc-sev-severe {
    background: color-mix(in srgb, var(--warning) 22%, transparent);
    color: var(--warning);
  }
  .pc-sev-minor {
    background: color-mix(in srgb, var(--neutral-500) 22%, transparent);
    color: var(--text-secondary);
  }
  .pc-owner {
    font-weight: 600;
  }
  .pc-when {
    color: var(--text-secondary);
    font-size: 0.85rem;
  }
  .pc-detail {
    margin: 0;
    font-size: 0.9rem;
  }
  .pc-muted {
    color: var(--text-secondary);
  }
  @media (max-width: 560px) {
    .pc-grid {
      grid-template-columns: 1fr;
    }
    .pc-row {
      flex-direction: column;
    }
  }

  /* Desktop (#124): log a failure beside the validation queue. */
  .pc-columns {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: var(--space-7);
    align-items: start;
  }
  @media (max-width: 1100px) {
    .pc-columns {
      grid-template-columns: 1fr;
    }
  }
  /* Phone (#124) */
  @media (max-width: 900px) {
    .pitcrew .sp-lede {
      display: none;
    }
    .pc-grid {
      grid-template-columns: 1fr;
    }
    .pc-actions .btn {
      width: 100%;
      min-height: var(--tap-comfort);
      justify-content: center;
    }
    .pc-row {
      flex-direction: column;
      align-items: stretch;
    }
    .pc-row .btn {
      min-height: var(--tap-min);
      justify-content: center;
    }
  }
  .pc-dock {
    position: fixed;
    left: calc(var(--page-gutter) + var(--safe-left));
    right: calc(var(--page-gutter) + var(--safe-right));
    bottom: calc(var(--dock-height) + var(--space-2));
    z-index: 10;
    min-height: var(--tap-comfort);
    justify-content: center;
    gap: var(--space-2);
    font-size: 1rem;
    box-shadow: var(--shadow-dock);
  }
  @media (max-width: 900px) {
    .pitcrew {
      padding-bottom: 4.5rem;
    }
  }
</style>

<script>
  // Scouting Admin > People > Roles: build roles out of permissions and give them to people. Everyone without a role
  // is a Member. Permissions only reach people through a role (the API rewrites holders' permissions on every change).
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { Check, Plus, Search, ShieldCheck, Trash2, Users, X } from 'lucide-svelte';
  import Select from '$lib/components/common/Select.svelte';
  import { authFetch } from '$lib/app/supabase.js';
  import { requestConfirmation } from '$lib/app/confirmation.js';
  import { permissionGroups, searchPermissions } from '$lib/app/accessRoles.js';

  let loading = true;
  let error = '';
  let notice = '';
  let saving = false;
  let catalog = [];
  let roles = [];
  let people = [];
  let can = { editRoles: false, assignRoles: false, grantable: [] };
  let memberRole = 'Member';

  // The role open in the editor: 'member', 'new', or a role id.
  let selected = 'member';
  let draft = { name: '', description: '', permissions: [] };
  let permissionQuery = '';
  let addPerson = '';

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await authFetch('/api/access-roles');
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not load roles.');
      ({ catalog, roles, people, can, memberRole } = result);
      if (selected !== 'member' && selected !== 'new' && !roles.some((role) => role.id === selected)) select('member');
    } catch (cause) {
      error = cause.message;
    } finally {
      loading = false;
    }
  }
  onMount(load);

  $: holdersOf = (id) => people.filter((person) => (person.access_role_id || null) === id);
  $: current = roles.find((role) => role.id === selected) || null;
  $: holders = selected === 'member' ? holdersOf(null) : selected === 'new' ? [] : holdersOf(selected);
  $: shown = searchPermissions(permissionQuery, catalog);
  $: groups = permissionGroups(shown);
  $: grantable = new Set(can.grantable || []);
  $: dirty =
    selected === 'new' ||
    (current &&
      (draft.name !== current.name ||
        draft.description !== current.description ||
        draft.permissions.join() !== current.permissions.join()));
  $: candidates = people.filter((person) => (person.access_role_id || null) !== (current?.id || null));
  const nameOf = (person) => person.full_name || person.email || 'Unnamed account';

  function select(id) {
    selected = id;
    notice = '';
    error = '';
    permissionQuery = '';
    const role = roles.find((r) => r.id === id);
    draft = role
      ? { name: role.name, description: role.description || '', permissions: [...role.permissions] }
      : { name: '', description: '', permissions: [] };
  }

  function toggle(key) {
    if (!can.editRoles || !grantable.has(key)) return;
    draft.permissions = draft.permissions.includes(key)
      ? draft.permissions.filter((k) => k !== key)
      : [...draft.permissions, key];
  }

  function toggleGroup(group) {
    const keys = group.permissions.map((p) => p.key).filter((key) => grantable.has(key));
    const allOn = keys.every((key) => draft.permissions.includes(key));
    draft.permissions = allOn
      ? draft.permissions.filter((key) => !keys.includes(key))
      : [...new Set([...draft.permissions, ...keys])];
  }

  async function post(body) {
    const response = await authFetch('/api/access-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Could not save.');
    return result;
  }

  async function save() {
    saving = true;
    error = '';
    notice = '';
    try {
      const creating = selected === 'new';
      const result = await post({ action: creating ? 'create' : 'update', role: { ...draft, id: current?.id } });
      await load();
      select(result.role.id);
      notice = creating
        ? `Created ${result.role.name}.`
        : `Saved ${result.role.name}. Everyone with this role has the new permissions.`;
    } catch (cause) {
      error = cause.message;
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (!current) return;
    const count = holders.length;
    const ok = await requestConfirmation({
      title: `Delete ${current.name}`,
      message: count
        ? `${count} ${count === 1 ? 'person holds' : 'people hold'} this role. They become Members and lose its permissions.`
        : 'Nobody holds this role.',
      confirmLabel: 'Delete role',
      danger: true
    });
    if (!ok) return;
    saving = true;
    try {
      const name = current.name;
      await post({ action: 'delete', id: current.id });
      await load();
      select('member');
      notice = `Deleted ${name}.`;
    } catch (cause) {
      error = cause.message;
    } finally {
      saving = false;
    }
  }

  async function assign(userId, roleId) {
    saving = true;
    error = '';
    notice = '';
    try {
      await post({ action: 'assign', user_id: userId, role_id: roleId });
      await load();
      const person = people.find((p) => p.id === userId);
      const who = person ? nameOf(person) : 'They';
      const roleName = roles.find((role) => role.id === roleId)?.name;
      notice = roleId ? `${who} now holds ${roleName || 'the role'}.` : `${who} is a ${memberRole} again.`;
    } catch (cause) {
      error = cause.message;
    } finally {
      saving = false;
      addPerson = '';
    }
  }
</script>

<section class="roles" aria-label="Roles">
  {#if loading && !roles.length}
    <p class="muted">Loading roles…</p>
  {:else}
    <aside class="role-list" aria-label="Roles">
      <button class="role-item" class:on={selected === 'member'} on:click={() => select('member')}>
        <span class="role-main"><b>{memberRole}</b><small>Everyone without a role</small></span>
        <span class="role-count" title="People"><Users size={13} />{holdersOf(null).length}</span>
      </button>
      {#each roles as role (role.id)}
        <button class="role-item" class:on={selected === role.id} on:click={() => select(role.id)}>
          <span class="role-main"
            ><b>{role.name}</b><small
              >{role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}</small
            ></span
          >
          <span class="role-count" title="People"><Users size={13} />{holdersOf(role.id).length}</span>
        </button>
      {/each}
      {#if can.editRoles}
        <button class="role-new" class:on={selected === 'new'} on:click={() => select('new')}
          ><Plus size={15} /> New role</button
        >
      {/if}
    </aside>

    <div class="role-editor">
      {#if error}<div class="status-message status-error" role="alert">{error}</div>{/if}
      {#if notice}<div class="status-message status-success" role="status">{notice}</div>{/if}

      {#if selected === 'member'}
        <div class="card-ish">
          <header class="ed-head">
            <span class="ed-icon"><ShieldCheck size={18} /></span>
            <div>
              <h3>{memberRole}</h3>
              <p>
                The built-in role for every approved account without another role: use the app, scout matches and pits,
                and read the analysis pages. It can't be changed or deleted.
              </p>
            </div>
          </header>
        </div>
      {:else}
        <div class="card-ish">
          <header class="ed-head">
            <span class="ed-icon"><ShieldCheck size={18} /></span>
            <div class="ed-fields">
              <label class="ed-label" for="role-name">Role name</label>
              <input
                id="role-name"
                class="form-input"
                maxlength="40"
                placeholder="e.g. Pit Lead"
                bind:value={draft.name}
                disabled={!can.editRoles}
              />
              <label class="ed-label" for="role-desc">Description <span class="opt">(optional)</span></label>
              <input
                id="role-desc"
                class="form-input"
                maxlength="200"
                placeholder="What this role is for"
                bind:value={draft.description}
                disabled={!can.editRoles}
              />
            </div>
          </header>

          <div class="perm-head">
            <h4>Permissions <span class="count">{draft.permissions.length} of {catalog.length}</span></h4>
            <label class="perm-search">
              <Search size={15} />
              <input
                type="search"
                placeholder="Search permissions"
                aria-label="Search permissions"
                bind:value={permissionQuery}
              />
            </label>
          </div>

          {#each groups as group (group.group)}
            <div class="perm-group">
              <div class="perm-group-head">
                <span>{group.group}</span>
                {#if can.editRoles}
                  <button type="button" class="text-btn" on:click={() => toggleGroup(group)}
                    >{group.permissions.every((p) => draft.permissions.includes(p.key))
                      ? 'Clear'
                      : 'Select all'}</button
                  >
                {/if}
              </div>
              {#each group.permissions as permission (permission.key)}
                {@const on = draft.permissions.includes(permission.key)}
                {@const locked = !can.editRoles || !grantable.has(permission.key)}
                <button
                  type="button"
                  class="perm"
                  class:on
                  class:locked
                  role="switch"
                  aria-checked={on}
                  disabled={locked}
                  title={locked && can.editRoles ? "You can't give a permission you don't have." : undefined}
                  on:click={() => toggle(permission.key)}
                >
                  <span class="perm-text"><b>{permission.label}</b><small>{permission.description}</small></span>
                  <span class="toggle" aria-hidden="true"><i></i></span>
                </button>
              {/each}
            </div>
          {:else}
            <p class="muted">No permission matches "{permissionQuery}".</p>
          {/each}

          {#if can.editRoles}
            <div class="ed-actions">
              <button class="btn btn-primary" disabled={saving || !dirty || !draft.name.trim()} on:click={save}
                ><Check size={15} /> {selected === 'new' ? 'Create role' : 'Save changes'}</button
              >
              {#if current}
                <button class="btn btn-outline-danger" disabled={saving} on:click={remove}
                  ><Trash2 size={15} /> Delete role</button
                >
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      {#if selected !== 'new'}
        <div class="card-ish" transition:slide={{ duration: 160 }}>
          <div class="perm-head">
            <h4>People <span class="count">{holders.length}</span></h4>
            {#if can.assignRoles && current}
              <div class="add-person">
                <Select bind:value={addPerson} aria-label="Give this role to someone">
                  <option value="">Give this role to…</option>
                  {#each candidates as person (person.id)}<option value={person.id}>{nameOf(person)}</option>{/each}
                </Select>
                <button
                  class="btn btn-outline btn-sm"
                  disabled={!addPerson || saving}
                  on:click={() => assign(addPerson, current.id)}>Add</button
                >
              </div>
            {/if}
          </div>
          {#if holders.length}
            <ul class="holders">
              {#each holders as person (person.id)}
                <li>
                  <span class="avatar" aria-hidden="true">{nameOf(person).slice(0, 1).toUpperCase()}</span>
                  <span class="holder-text"
                    ><b>{nameOf(person)}</b>{#if person.email}<small>{person.email}</small>{/if}</span
                  >
                  {#if can.assignRoles && current}
                    <button
                      class="icon-btn"
                      disabled={saving}
                      aria-label={`Make ${nameOf(person)} a ${memberRole}`}
                      title={`Make a ${memberRole}`}
                      on:click={() => assign(person.id, null)}><X size={15} /></button
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">Nobody holds this role yet.</p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .roles {
    display: grid;
    grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
  }
  .role-list {
    position: sticky;
    top: calc(var(--strip-height, 3rem) + var(--space-3));
    display: grid;
    gap: 2px;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .role-item,
  .role-new {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .role-item:hover,
  .role-new:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }
  .role-item.on,
  .role-new.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .role-main {
    display: grid;
    min-width: 0;
  }
  .role-main b {
    font-weight: 500;
    overflow-wrap: anywhere;
  }
  .role-main small {
    color: var(--text-muted);
    font-size: 0.78rem;
  }
  .role-count {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .role-new {
    justify-content: flex-start;
    margin-top: var(--space-1);
    border-top: 1px solid var(--border);
    border-radius: 0 0 var(--radius-md) var(--radius-md);
    color: var(--text-secondary);
  }
  .role-editor {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .card-ish {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }
  .ed-head {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .ed-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-strong, var(--text));
  }
  .ed-head h3 {
    margin: 0.3rem 0 0;
    font-size: 1.1rem;
    font-weight: 500;
  }
  .ed-head p {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .ed-fields {
    display: grid;
    gap: var(--space-1);
    flex: 1;
    min-width: 0;
  }
  .ed-label {
    margin-top: var(--space-2);
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .ed-label:first-child {
    margin-top: 0;
  }
  .opt {
    color: var(--text-muted);
    font-weight: 400;
  }
  .perm-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .perm-head h4 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .count {
    padding: 0.05rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    color: var(--text-muted);
    font-size: 0.75rem;
    letter-spacing: 0;
  }
  .perm-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: min(18rem, 100%);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    color: var(--text-muted);
  }
  .perm-search:focus-within {
    border-color: var(--accent);
  }
  .perm-search input {
    flex: 1;
    min-width: 0;
    min-height: 2.25rem;
    border: 0;
    outline: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: max(16px, 0.9rem);
  }
  .perm-group {
    display: grid;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .perm-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    color: var(--text-secondary);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .text-btn {
    border: 0;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .text-btn:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .perm {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-3);
    border: 0;
    border-top: 1px solid var(--border);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  .perm:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }
  .perm.locked {
    cursor: default;
    opacity: 0.6;
  }
  .perm-text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .perm-text b {
    font-weight: 500;
  }
  .perm-text small {
    color: var(--text-muted);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  /* A switch: a track with a knob that slides across when on. */
  .toggle {
    position: relative;
    flex: none;
    width: 2.4rem;
    height: 1.35rem;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    box-shadow: inset 0 0 0 1px var(--border);
    transition: background-color 0.18s ease;
  }
  .toggle i {
    position: absolute;
    top: 3px;
    left: 3px;
    width: calc(1.35rem - 6px);
    height: calc(1.35rem - 6px);
    border-radius: 50%;
    background: var(--text-muted);
    transition:
      transform 0.18s ease,
      background-color 0.18s ease;
  }
  .perm.on .toggle {
    background: color-mix(in srgb, var(--accent) 55%, var(--surface-3));
  }
  .perm.on .toggle i {
    transform: translateX(1.05rem);
    background: var(--text-strong, var(--text));
  }
  .ed-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .add-person {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: min(20rem, 100%);
  }
  .add-person :global(.form-group),
  .add-person :global(> :first-child) {
    flex: 1;
    margin: 0;
  }
  .holders {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .holders li {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-md);
  }
  .holders li:hover {
    background: color-mix(in srgb, var(--text) 4%, transparent);
  }
  .avatar {
    display: grid;
    place-items: center;
    flex: none;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 20%, var(--surface-2));
    color: var(--text-strong, var(--text));
    font-weight: 600;
  }
  .holder-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .holder-text b {
    font-weight: 500;
  }
  .holder-text small {
    color: var(--text-muted);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
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
  .icon-btn:hover {
    color: var(--text);
  }
  @media (max-width: 900px) {
    .roles {
      grid-template-columns: 1fr;
    }
    .role-list {
      position: static;
    }
    .perm-search {
      min-width: 100%;
    }
    .perm,
    .role-item,
    .holders li {
      min-height: var(--tap-min);
    }
  }
</style>

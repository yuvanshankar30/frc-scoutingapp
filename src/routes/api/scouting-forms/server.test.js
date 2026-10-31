import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuestion } from '$lib/scouting/forms/formSchema.js';

// A small in-memory stand-in for the Supabase client: just the calls the route makes.
function fakeDb(tables) {
  const from = (name) => {
    const rows = tables[name];
    let filters = [],
      order = null,
      max = Infinity,
      op = 'select',
      payload = null;
    const run = () => {
      let found = rows.filter((row) => filters.every(([key, values]) => values.includes(row[key])));
      if (order) found = [...found].sort((a, b) => (order.asc ? 1 : -1) * (a[order.key] - b[order.key]));
      return found.slice(0, max);
    };
    const api = {
      select: () => api,
      eq: (key, value) => {
        filters.push([key, [value]]);
        return api;
      },
      in: (key, values) => {
        filters.push([key, values]);
        return api;
      },
      order: (key, { ascending }) => {
        order = { key, asc: ascending };
        return api;
      },
      limit: (n) => {
        max = n;
        return api;
      },
      insert: (row) => {
        op = 'insert';
        payload = { ...row, id: `id${rows.length + 1}`, published_at: '2026-10-09T00:00:00Z' };
        return api;
      },
      upsert: (row, { onConflict }) => {
        op = 'upsert';
        payload = row;
        payload.__key = onConflict;
        return api;
      },
      delete: () => {
        op = 'delete';
        return api;
      },
      then: (resolve) => {
        if (op === 'delete') {
          for (const row of run()) rows.splice(rows.indexOf(row), 1);
        } else if (op === 'upsert') {
          const at = rows.findIndex((row) => row[payload.__key] === payload[payload.__key]);
          const { __key, ...clean } = payload;
          at >= 0 ? (rows[at] = clean) : rows.push(clean);
        }
        resolve({ data: op === 'select' ? run() : null, error: null });
      },
      maybeSingle: async () => ({ data: run()[0] || null, error: null }),
      single: async () => {
        if (op === 'insert') {
          if (rows.some((row) => row.form_type === payload.form_type && row.version === payload.version))
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          rows.push(payload);
          return { data: payload, error: null };
        }
        return { data: run()[0] || null, error: null };
      }
    };
    return api;
  };
  return { from };
}

let actor, tables;
vi.mock('$lib/server/scouting/scoutingAccess.js', () => ({ actorFor: async () => ({ ...actor, db: fakeDb(tables) }) }));

const { GET, POST } = await import('./+server.js');
const post = (body) => POST({ request: { json: async () => body } });
const get = (query) => GET({ url: new URL(`http://x/api/scouting-forms?${query}`), request: {} });
const read = async (response) => ({ status: response.status, ...(await response.json()) });
const good = { ...createQuestion('buttons', 'teleop'), label: 'Climbed?' };

beforeEach(() => {
  actor = { actorId: 'u1', canAdminister: true };
  tables = {
    scouting_form_versions: [],
    scouting_form_drafts: [],
    user_profiles: [{ id: 'u1', full_name: 'Alex', email: 'a@x' }]
  };
});

describe('scouting forms API', () => {
  it('serves an empty live form before anything is published', async () => {
    const res = await read(await get('form=match'));
    expect(res.data).toMatchObject({ version: 0, schema: { questions: [] } });
  });

  it('keeps drafts private to admins', async () => {
    actor = { actorId: 'u2', canAdminister: false };
    expect((await read(await get('form=match&admin=1'))).status).toBe(403);
    expect(
      (await read(await post({ action: 'save-draft', form: 'match', schema: { questions: [good] } }))).status
    ).toBe(403);
  });

  it('saves a draft, publishes it as version 1, and clears the draft', async () => {
    await post({ action: 'save-draft', form: 'match', schema: { questions: [good] }, base_version: 0 });
    expect(tables.scouting_form_drafts).toHaveLength(1);
    const published = await read(
      await post({ action: 'publish', form: 'match', schema: { questions: [good] }, base_version: 0, note: 'First' })
    );
    expect(published.data.version).toBe(1);
    expect(tables.scouting_form_drafts).toHaveLength(0);
    const live = await read(await get('form=match'));
    expect(live.data.version).toBe(1);
    expect(live.data.schema.questions[0].label).toBe('Climbed?');
  });

  it('refuses to publish questions that need fixing', async () => {
    const res = await read(
      await post({ action: 'publish', form: 'match', schema: { questions: [{ ...good, label: '' }] }, base_version: 0 })
    );
    expect(res.status).toBe(400);
    expect(res.problems[good.id]).toBeTruthy();
    expect(tables.scouting_form_versions).toHaveLength(0);
  });

  it('rejects a publish built on an out-of-date version', async () => {
    await post({ action: 'publish', form: 'match', schema: { questions: [good] }, base_version: 0 });
    const stale = await read(
      await post({ action: 'publish', form: 'match', schema: { questions: [] }, base_version: 0 })
    );
    expect(stale.status).toBe(409);
    expect(stale.live_version).toBe(1);
  });

  it('keeps older versions, newest first, with who published them', async () => {
    await post({
      action: 'publish',
      form: 'pit',
      schema: { questions: [{ ...good, section: 'main' }] },
      base_version: 0
    });
    await post({ action: 'publish', form: 'pit', schema: { questions: [] }, base_version: 1, restored_from: 1 });
    const admin = await read(await get('form=pit&admin=1'));
    expect(admin.data.live_version).toBe(2);
    expect(admin.data.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(admin.data.versions[0].restored_from).toBe(1);
    expect(admin.data.versions[1].published_by).toBe('Alex');
    expect((await read(await get('form=pit&version=1'))).data.schema.questions).toHaveLength(1);
  });

  it('drops questions whose section does not belong to the form', async () => {
    await post({ action: 'publish', form: 'pit', schema: { questions: [good] }, base_version: 0 });
    expect((await read(await get('form=pit'))).data.schema.questions).toEqual([]);
  });

  it('keeps reworded, hidden and reordered built-in questions through a publish', async () => {
    const schema = {
      questions: [good],
      core: {
        'teleop.notes': { label: 'Anything to add?', hidden: true },
        'teleop.roles': { hidden: true },
        'bogus.key': { label: 'x' }
      },
      order: { teleop: [good.id, 'core:teleop.notes', 'nope'] }
    };
    await post({ action: 'publish', form: 'match', schema, base_version: 0 });
    const live = (await read(await get('form=match'))).data.schema;
    expect(live.core).toEqual({ 'teleop.notes': { label: 'Anything to add?', hidden: true } });
    expect(live.order.teleop).toEqual([good.id, 'core:teleop.notes']);
  });

  it('counts a built-in change as something to publish', async () => {
    const schema = { questions: [], core: { 'teleop.notes': { hidden: true } }, order: {} };
    expect((await read(await post({ action: 'publish', form: 'match', schema, base_version: 0 }))).status).toBe(200);
  });

  it('discards a draft', async () => {
    await post({ action: 'save-draft', form: 'match', schema: { questions: [good] }, base_version: 0 });
    await post({ action: 'discard-draft', form: 'match' });
    expect(tables.scouting_form_drafts).toHaveLength(0);
  });
});

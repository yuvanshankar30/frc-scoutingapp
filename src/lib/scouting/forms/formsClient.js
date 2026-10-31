import { getAuthHeader } from '$lib/app/supabase.js';
import { emptyForm } from './formSchema.js';

async function call(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), ...(await getAuthHeader()) } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success)
    throw Object.assign(new Error(data?.error || `Request failed (${res.status})`), { status: res.status, data });
  return data.data;
}

const post = (body) =>
  call('/api/scouting-forms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

export const loadAdminForm = (form) => call(`/api/scouting-forms?form=${form}&admin=1`);
export const saveDraft = (form, schema, baseVersion) =>
  post({ action: 'save-draft', form, schema, base_version: baseVersion });
export const discardDraft = (form) => post({ action: 'discard-draft', form });
export const publishForm = (form, schema, baseVersion, note, restoredFrom) =>
  post({ action: 'publish', form, schema, base_version: baseVersion, note, restored_from: restoredFrom });

// The live form a scout answers. Scouting pages call this once per visit; a missing or failing
// request just means "no added questions", so the built-in form always works.
const cache = new Map();
export async function fetchLiveForm(form, { fresh = false } = {}) {
  const hit = cache.get(form);
  if (!fresh && hit && Date.now() - hit.at < 30000) return hit.value;
  try {
    const value = await call(`/api/scouting-forms?form=${form}`);
    cache.set(form, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value || { version: 0, schema: emptyForm() };
  }
}

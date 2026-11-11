// Scouting Admin > Team settings: change the team, branding and features.
// Admins and the Competition Lead may change them; everyone can read them (the sign-in page shows them).
import { json } from '@sveltejs/kit';
import { requireApprovedUser } from '$lib/server/scouting/scoutingAccess.js';
import { canEditTeamSettings, decodeLogo, loadTeamSettings, saveTeamSettings } from '$lib/server/teamSettings.js';
import { validateTeamSettingsInput } from '$lib/app/teamSettings.js';
import { appearanceColumn, normalizeAppearance } from '$lib/app/appearance.js';
import { isValidTimeZone } from '$lib/app/timezone.js';
import { getSupabase } from '$lib/server/serviceClient.js';

const NO_STORE = { 'Cache-Control': 'no-store' };
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function GET() {
  const { settings, error } = await loadTeamSettings({ fresh: true });
  if (error) return json({ error }, { status: 500, headers: NO_STORE });
  return json({ settings }, { headers: NO_STORE });
}

export async function POST({ request }) {
  const access = await requireApprovedUser(request);
  if (!access.ok) return json({ error: access.error }, { status: access.status, headers: NO_STORE });
  if (!canEditTeamSettings(access.profile, access.rosterKeys))
    return json(
      { error: 'Only an admin or the Competition Lead can change team settings.' },
      { status: 403, headers: NO_STORE }
    );

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE });
  const db = getSupabase();

  if (body.action === 'upload-logo' || body.action === 'remove-logo') {
    let logoUrl = null;
    if (body.action === 'upload-logo') {
      const logo = decodeLogo(body.dataUrl);
      if (logo.error) return json({ error: logo.error }, { status: 400, headers: NO_STORE });
      // A new name each time, so browsers and the CDN never show the old logo from cache.
      const path = `logo-${Date.now()}.${LOGO_TYPES[logo.type]}`;
      const uploaded = await db.storage
        .from('branding')
        .upload(path, logo.bytes, { contentType: logo.type, upsert: false });
      if (uploaded.error) return json({ error: uploaded.error.message }, { status: 500, headers: NO_STORE });
      logoUrl = db.storage.from('branding').getPublicUrl(path).data.publicUrl;
    }
    const previous = (await loadTeamSettings({ fresh: true })).settings?.logoUrl || '';
    const settings = await saveTeamSettings({ logo_url: logoUrl, updated_by: access.actorId }, { db });
    const oldPath = previous.split('/branding/')[1];
    if (oldPath)
      await db.storage
        .from('branding')
        .remove([decodeURIComponent(oldPath)])
        .catch(() => {});
    return json({ success: true, settings }, { headers: NO_STORE });
  }

  // Browser tab icon: an uploaded picture, saved straight into the appearance (Team settings > Browser tab icon).
  if (body.action === 'upload-tab-icon' || body.action === 'remove-tab-icon') {
    const current = (await loadTeamSettings({ fresh: true })).settings;
    const appearance = normalizeAppearance(current?.appearance);
    let url = '';
    if (body.action === 'upload-tab-icon') {
      const icon = decodeLogo(body.dataUrl);
      if (icon.error) return json({ error: icon.error }, { status: 400, headers: NO_STORE });
      const path = `tab-icon-${Date.now()}.${LOGO_TYPES[icon.type]}`;
      const uploaded = await db.storage
        .from('branding')
        .upload(path, icon.bytes, { contentType: icon.type, upsert: false });
      if (uploaded.error) return json({ error: uploaded.error.message }, { status: 500, headers: NO_STORE });
      url = db.storage.from('branding').getPublicUrl(path).data.publicUrl;
    }
    const tabIcon = url ? 'custom' : appearance.tabIcon === 'custom' ? 'badge' : appearance.tabIcon;
    const next = { ...appearance, tabIconUrl: url, tabIcon };
    const settings = await saveTeamSettings({ appearance: appearanceColumn(next), updated_by: access.actorId }, { db });
    const oldPath = (appearance.tabIconUrl || '').split('/branding/')[1];
    if (oldPath)
      await db.storage
        .from('branding')
        .remove([decodeURIComponent(oldPath)])
        .catch(() => {});
    return json({ success: true, settings }, { headers: NO_STORE });
  }

  const { value, error } = validateTeamSettingsInput(body.settings, { isValidTimeZone });
  if (error) return json({ error }, { status: 400, headers: NO_STORE });
  // The tab icon's picture only changes through upload-tab-icon, so a save can't point it at any other address.
  if (value.appearance) {
    const stored = normalizeAppearance((await loadTeamSettings({ fresh: true })).settings?.appearance);
    value.appearance = { ...value.appearance, tab_icon_url: stored.tabIconUrl };
    if (value.appearance.tab_icon === 'custom' && !stored.tabIconUrl) value.appearance.tab_icon = 'badge';
  }
  try {
    const settings = await saveTeamSettings({ ...value, updated_by: access.actorId }, { db });
    return json({ success: true, settings }, { headers: NO_STORE });
  } catch (cause) {
    return json({ error: cause?.message || 'Could not save the settings' }, { status: 500, headers: NO_STORE });
  }
}

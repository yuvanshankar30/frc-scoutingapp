import { redirect } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { loadTeamSettings } from '$lib/server/teamSettings.js';

// Every route in this app POSTs JSON over fetch(). Real HTML form submissions
// and no-cors requests with an empty Content-Type (the content types a browser
// can send cross-site without a preflight) are only accepted from the app's own origin.
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', ''];

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

export async function csrfCheck({ event, resolve }) {
  const { request, url } = event;
  const method = request.method;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (FORM_CONTENT_TYPES.includes(contentType)) {
      const origin = request.headers.get('origin');
      if (!origin || origin !== url.origin) {
        return new Response(`Cross-site ${method} form submissions are forbidden`, { status: 403 });
      }
    }
  }
  const response = await resolve(event);
  try {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(header)) {
        response.headers.set(header, value);
      }
    }
  } catch {
    // Response headers may be immutable on synthetic redirect/fetch responses.
  }
  return response;
}

// Pages that work before first-run setup is done.
const isSetupPath = (pathname) => pathname === '/setup' || pathname.startsWith('/api/setup');

/**
 * Until first-run setup is done, every page goes to /setup; afterwards /setup goes home. Only page loads are
 * redirected (API routes answer for themselves), and nothing is redirected when the settings could not be read
 * at all, so a database outage shows the real error instead of the setup page.
 */
export async function setupGate({ event, resolve }) {
  const { pathname } = event.url;
  const isPage = event.request.method === 'GET' && !pathname.startsWith('/api/');
  if (!isPage) return resolve(event);
  const { settings, error } = await loadTeamSettings();
  if (error) return resolve(event);
  const configured = Boolean(settings?.configured);
  if (!configured && !isSetupPath(pathname)) redirect(303, '/setup');
  if (configured && pathname === '/setup') redirect(303, '/');
  return resolve(event);
}

export const handle = sequence(csrfCheck, setupGate);

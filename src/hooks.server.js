import { sequence } from '@sveltejs/kit/hooks';

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

// The form designer (Scouting Admin > Edit) shows the real scouting page in a frame, so that one view may be framed,
// but only by this site itself. Everything else stays unframeable.
const DESIGN_PAGES = new Set(['/matchscout', '/pitscout']);
const SAME_ORIGIN_FRAMING = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'"
};
export const framingHeaders = (url) =>
  DESIGN_PAGES.has(url.pathname) && url.searchParams.get('design') === '1' ? SAME_ORIGIN_FRAMING : {};

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
    for (const [header, value] of Object.entries({ ...SECURITY_HEADERS, ...framingHeaders(url) })) {
      if (!response.headers.has(header)) {
        response.headers.set(header, value);
      }
    }
    // API answers hold scouting data for one signed-in person, so no browser or proxy may keep them unless a route
    // says otherwise (the public /api/tba/* data and the manifest do).
    if (url.pathname.startsWith('/api/') && !response.headers.has('cache-control')) {
      response.headers.set('Cache-Control', 'private, no-store');
    }
  } catch {
    // Response headers may be immutable on synthetic redirect/fetch responses.
  }
  return response;
}

export const handle = sequence(csrfCheck);

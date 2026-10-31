const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const INTERNAL_ORIGIN = 'https://app.invalid';

/**
 * Returns a normalized http(s) URL string, or '' for any other scheme
 * (javascript:, data:, vbscript:, file:, relative paths, or malformed input).
 */
export function safeUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value || CONTROL_CHARS.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.href;
  } catch {
    return '';
  }
}

export const safeExternalHttpUrl = safeUrl;

/**
 * Validates an internal same-origin path (e.g. from ?next= or ?from=),
 * rejecting scheme-relative URLs (//host), backslash authority bypasses (/\host),
 * control characters, and external origins.
 */
export function safeInternalPath(raw, fallback = '/') {
  const value = String(raw ?? '').trim();
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || CONTROL_CHARS.test(value)) {
    return fallback;
  }
  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN || !parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

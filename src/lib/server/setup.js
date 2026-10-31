// Checks for first-run setup (see src/routes/api/setup).
import { createHash, timingSafeEqual } from 'node:crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const digest = (value) =>
  createHash('sha256')
    .update(String(value ?? ''), 'utf8')
    .digest();
/** Constant-time comparison, so the token cannot be guessed a character at a time. */
export const tokenMatches = (given, expected) => Boolean(expected) && timingSafeEqual(digest(given), digest(expected));

export function validateAdminInput(input = {}) {
  const fullName = String(input.fullName ?? '')
    .trim()
    .slice(0, 80);
  const email = String(input.email ?? '')
    .trim()
    .toLowerCase();
  const password = String(input.password ?? '');
  if (!fullName) return { value: null, error: 'Enter your name.' };
  if (!EMAIL_RE.test(email) || email.length > 254) return { value: null, error: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD)
    return { value: null, error: `Use a password of at least ${MIN_PASSWORD} characters.` };
  return { value: { fullName, email, password }, error: null };
}

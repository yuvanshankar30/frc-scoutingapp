import { env } from '$env/dynamic/public';

// Shared scouting logins often have no real mailbox, so a bare username like "pit1" is shorthand for an address
// at this domain. Nothing is ever sent there. Set PUBLIC_USERNAME_EMAIL_DOMAIN to use your own domain.
export const DEFAULT_USERNAME_EMAIL_DOMAIN = 'scouting.local';

export const usernameEmailDomain = () =>
  String(env.PUBLIC_USERNAME_EMAIL_DOMAIN || '')
    .trim()
    .toLowerCase() || DEFAULT_USERNAME_EMAIL_DOMAIN;

export function toEmail(identifier, domain = usernameEmailDomain()) {
  const value = String(identifier ?? '').trim();
  return value.includes('@') ? value.toLowerCase() : `${value.toLowerCase()}@${domain}`;
}

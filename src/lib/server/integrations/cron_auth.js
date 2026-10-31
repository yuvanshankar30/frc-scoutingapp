import { bearerToken, tokensMatch } from '$lib/server/bearerAuth.js';

export function getCronSecrets(envLike = {}) {
  return Array.from(
    new Set(
      [envLike?.NOTIFICATION_CRON_TOKEN, envLike?.CRON_NOTIFICATION_TOKEN, envLike?.CRON_SECRET]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

export function isAuthorizedCronRequest({ headers, env: envLike = {} } = {}) {
  const expectedSecrets = getCronSecrets(envLike);
  if (!expectedSecrets.length) return false;

  const token = bearerToken(headers);
  if (!token) return false;

  return expectedSecrets.some((secret) => tokensMatch(token, secret));
}

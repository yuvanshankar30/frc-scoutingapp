import { describe, expect, it } from 'vitest';
import { redactSecretText } from './redact.js';

describe('redactSecretText', () => {
  it('hides query strings, JWTs, API keys, Slack tokens and bearer tokens', () => {
    expect(redactSecretText('GET https://x.example/a?key=1&b=2 failed')).toBe(
      'GET https://x.example/a?<redacted> failed'
    );
    expect(redactSecretText('jwt eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl')).toBe('jwt <redacted-jwt>');
    expect(redactSecretText('key AIzaSyA1234567890abcdefghijk')).toBe('key <redacted-key>');
    expect(redactSecretText('bad xoxb-1234567890-abc')).toBe('bad <redacted-key>');
    expect(redactSecretText('Authorization: Bearer abcdefghijklmnop')).toBe('Authorization: Bearer <redacted>');
    expect(redactSecretText(null)).toBe('');
  });
});

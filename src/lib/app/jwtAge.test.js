import { describe, it, expect } from 'vitest';
import { tokenAgeSeconds } from './jwtAge.js';

const tokenIssuedAt = (iat) =>
  `h.${btoa(JSON.stringify({ iat })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`;

describe('tokenAgeSeconds', () => {
  it('measures from the issued-at claim', () => {
    expect(tokenAgeSeconds(tokenIssuedAt(1000), 1090 * 1000)).toBe(90);
    expect(tokenAgeSeconds(tokenIssuedAt(1000), 1000 * 1000)).toBe(0);
  });
  it('treats anything it cannot read as too old', () => {
    expect(tokenAgeSeconds('nonsense')).toBe(Infinity);
    expect(tokenAgeSeconds(tokenIssuedAt('soon'))).toBe(Infinity);
    expect(tokenAgeSeconds(undefined)).toBe(Infinity);
  });
});

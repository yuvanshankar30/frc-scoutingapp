import { describe, expect, it } from 'vitest';
import { ALLOWED_PATHS, proposalIsSendable } from './allowedPaths.js';

const req = (over = {}) => ({ method: 'POST', path: '/api/scouting-picklist', body: { action: 'add' }, ...over });

describe('proposalIsSendable', () => {
  it('accepts requests to the allowed endpoints only', () => {
    expect(proposalIsSendable({ requests: [req(), req({ path: '/notescout' })] })).toBe(true);
    expect(ALLOWED_PATHS).toEqual(['/api/scouting-picklist', '/notescout']);
  });
  it('refuses any other path, method or body shape', () => {
    for (const bad of [
      req({ path: '/api/scouting-admin/assignments' }),
      req({ path: 'https://evil.example/x' }),
      req({ path: '/api/scouting-picklist/../vision' }),
      req({ method: 'DELETE' }),
      req({ body: null }),
      req({ body: [] }),
      req({ body: 'x' })
    ]) {
      expect(proposalIsSendable({ requests: [req(), bad] })).toBe(false);
    }
  });
  it('refuses a proposal with no requests, too many, or nothing at all', () => {
    expect(proposalIsSendable({ requests: [] })).toBe(false);
    expect(proposalIsSendable({ requests: Array.from({ length: 13 }, () => req()) })).toBe(false);
    expect(proposalIsSendable(null)).toBe(false);
    expect(proposalIsSendable({})).toBe(false);
  });
});

describe('chained requests', () => {
  it('fills the previous id into a body, and only that exact token', async () => {
    const { fillBody, PREV_ID } = await import('./allowedPaths.js');
    expect(fillBody({ action: 'note', id: PREV_ID, note: 'x' }, { success: true, data: { id: 'row-1' } })).toEqual({
      action: 'note',
      id: 'row-1',
      note: 'x'
    });
    expect(fillBody({ action: 'note', id: PREV_ID }, {})).toEqual({ action: 'note', id: null });
    expect(fillBody({ note: `text with ${PREV_ID} inside` }, { data: { id: 'z' } })).toEqual({
      note: `text with ${PREV_ID} inside`
    });
  });
});

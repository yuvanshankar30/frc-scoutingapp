import { describe, expect, it, vi } from 'vitest';
import { holdScreenAwake } from './wakeLock.js';

function fakes() {
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => (listeners[type] = fn),
    removeEventListener: vi.fn()
  };
  const sentinel = { release: vi.fn(() => Promise.resolve()), addEventListener: vi.fn() };
  const nav = { wakeLock: { request: vi.fn(() => Promise.resolve(sentinel)) } };
  return { doc, nav, sentinel, listeners };
}

describe('holdScreenAwake', () => {
  it('takes the lock when asked and lets it go when no longer needed', async () => {
    const { doc, nav, sentinel } = fakes();
    const lock = holdScreenAwake(nav, doc);
    lock.set(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(nav.wakeLock.request).toHaveBeenCalledWith('screen');
    expect(lock.held).toBe(true);
    lock.set(false);
    expect(sentinel.release).toHaveBeenCalled();
    expect(lock.held).toBe(false);
  });

  it('takes it again when the page comes back into view', async () => {
    const { doc, nav, listeners } = fakes();
    const lock = holdScreenAwake(nav, doc);
    doc.visibilityState = 'hidden';
    lock.set(true);
    expect(nav.wakeLock.request).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    listeners.visibilitychange();
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
    lock.release();
    expect(doc.removeEventListener).toHaveBeenCalled();
  });

  it('does nothing where the API is missing', () => {
    const lock = holdScreenAwake({}, { visibilityState: 'visible' });
    expect(() => lock.set(true)).not.toThrow();
    expect(lock.held).toBe(false);
  });
});

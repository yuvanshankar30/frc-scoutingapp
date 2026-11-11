import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rejectAfter, withTimeout } from './withTimeout.js';

const never = () => new Promise(() => {});

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the value when the promise settles first', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'late')).resolves.toBe('ok');
  });

  it('returns the fallback when the promise stalls', async () => {
    const result = withTimeout(never(), 1000, 'late');
    vi.advanceTimersByTime(1000);
    await expect(result).resolves.toBe('late');
  });

  it('passes a rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'late')).rejects.toThrow('boom');
  });
});

describe('rejectAfter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rejects with a TimeoutError when the promise stalls', async () => {
    const result = rejectAfter(never(), 500, 'Photo upload timed out');
    vi.advanceTimersByTime(500);
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError', message: 'Photo upload timed out' });
  });

  it('resolves values, including falsy ones', async () => {
    await expect(rejectAfter(Promise.resolve(0), 500)).resolves.toBe(0);
  });
});

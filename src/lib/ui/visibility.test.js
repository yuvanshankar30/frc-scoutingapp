import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleInterval, whileVisible } from './visibility.js';

let state = 'visible';
const listeners = new Set();
function setVisibility(next) {
  state = next;
  for (const listener of listeners) listener();
}

beforeEach(() => {
  state = 'visible';
  listeners.clear();
  vi.useFakeTimers();
  vi.stubGlobal('document', {
    get visibilityState() {
      return state;
    },
    addEventListener: (type, fn) => {
      if (type === 'visibilitychange') listeners.add(fn);
    },
    removeEventListener: (type, fn) => {
      if (type === 'visibilitychange') listeners.delete(fn);
    }
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('visibleInterval', () => {
  it('ticks while visible, skips while hidden, and catches up when shown', () => {
    const fn = vi.fn();
    const stop = visibleInterval(fn, 1000);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    setVisibility('hidden');
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(2);
    setVisibility('visible');
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(listeners.size).toBe(0);
  });
});

describe('whileVisible', () => {
  it('joins while visible, leaves while hidden, and reloads after re-joining', () => {
    const join = vi.fn(),
      leave = vi.fn(),
      onShown = vi.fn();
    const stop = whileVisible(join, leave, onShown);
    expect(join).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    expect(leave).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    expect(leave).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(join).toHaveBeenCalledTimes(2);
    expect(onShown).toHaveBeenCalledTimes(1);
    stop();
    expect(leave).toHaveBeenCalledTimes(2);
  });
  it('does not join while starting hidden', () => {
    state = 'hidden';
    const join = vi.fn(),
      leave = vi.fn();
    const stop = whileVisible(join, leave);
    expect(join).not.toHaveBeenCalled();
    stop();
    expect(leave).not.toHaveBeenCalled();
  });
});

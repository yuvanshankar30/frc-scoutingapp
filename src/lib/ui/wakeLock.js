// Holds the screen awake while a page needs it (a scout watching a robot). The Screen Wake Lock API
// drops the lock whenever the tab is hidden, so it is taken again when the page comes back.
// Browsers without the API (older iOS) just keep their normal sleep timer.

export function holdScreenAwake(
  nav = typeof navigator === 'undefined' ? null : navigator,
  doc = typeof document === 'undefined' ? null : document
) {
  let wanted = false;
  let sentinel = null;

  async function acquire() {
    if (!wanted || sentinel || !nav?.wakeLock?.request || doc?.visibilityState === 'hidden') return;
    try {
      sentinel = await nav.wakeLock.request('screen');
      sentinel.addEventListener?.('release', () => {
        sentinel = null;
      });
    } catch {
      sentinel = null; // Denied (battery saver, not visible): the screen sleeps as usual.
    }
  }

  function drop() {
    const current = sentinel;
    sentinel = null;
    current?.release?.().catch?.(() => {});
  }

  const onVisible = () => {
    if (doc?.visibilityState === 'visible') void acquire();
  };
  doc?.addEventListener?.('visibilitychange', onVisible);

  return {
    /** true keeps the screen on, false lets it sleep again. */
    set(on) {
      wanted = Boolean(on);
      if (wanted) void acquire();
      else drop();
    },
    release() {
      wanted = false;
      drop();
      doc?.removeEventListener?.('visibilitychange', onVisible);
    },
    get held() {
      return Boolean(sentinel);
    }
  };
}

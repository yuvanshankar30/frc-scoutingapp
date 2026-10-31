// Polling and Realtime that pause while the browser tab is hidden. A tab left open in the background (a phone in
// a pocket, a laptop in the stands) otherwise keeps requesting and receiving data nobody is looking at, and every byte of
// it counts toward the Supabase organization's egress quota. Each helper catches up the moment the tab is shown
// again, so what a person sees is never staler than before.

export function tabHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Like setInterval(fn, ms), but skips ticks while the tab is hidden and runs fn once as soon as it is shown again.
 * Returns a function that stops it.
 */
export function visibleInterval(fn, ms) {
  const id = setInterval(() => {
    if (!tabHidden()) fn();
  }, ms);
  const onVisibility = () => {
    if (!tabHidden()) fn();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * Keeps a Realtime subscription only while the tab is visible: join() runs now (if visible) and whenever the tab
 * is shown, leave() whenever it is hidden. onShown runs after a re-join, to reload what changed while away.
 * Returns a function that stops it and leaves.
 */
export function whileVisible(join, leave, onShown = () => {}) {
  let joined = false;
  const sync = () => {
    if (tabHidden()) {
      if (joined) {
        joined = false;
        leave();
      }
    } else if (!joined) {
      joined = true;
      join();
      return true;
    }
    return false;
  };
  sync();
  const onVisibility = () => {
    if (sync()) onShown();
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    if (joined) {
      joined = false;
      leave();
    }
  };
}

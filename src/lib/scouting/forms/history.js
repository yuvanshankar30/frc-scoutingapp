// Undo and redo for the form editor. Each entry is a whole snapshot of the form (they are small),
// so stepping back and forward is exact. Edits to one thing in quick succession (typing in a
// question's text) share a `group` and fold into a single step.
export function createHistory(initial, limit = 100) {
  return { past: [], present: initial, future: [], group: null, limit };
}

export function pushHistory(history, next, group = null) {
  if (JSON.stringify(next) === JSON.stringify(history.present)) return history;
  const fold = group && history.group === group && history.past.length > 0;
  const past = fold ? history.past : [...history.past, history.present].slice(-history.limit);
  return { ...history, past, present: next, future: [], group };
}

export function undo(history) {
  if (!history.past.length) return history;
  const past = history.past.slice(0, -1);
  return {
    ...history,
    past,
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    group: null
  };
}

export function redo(history) {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return { ...history, past: [...history.past, history.present], present, future, group: null };
}

export const canUndo = (history) => history.past.length > 0;
export const canRedo = (history) => history.future.length > 0;

/** Replaces the whole history (loading a draft or another version), clearing undo. */
export const resetHistory = (history, present) => createHistory(present, history.limit);

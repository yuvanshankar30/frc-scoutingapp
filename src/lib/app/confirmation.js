import { writable } from 'svelte/store';

let subscriberCount = 0;
const state = writable(null, () => {
  subscriberCount += 1;
  return () => {
    subscriberCount = Math.max(0, subscriberCount - 1);
  };
});
let active = null;

export const confirmation = { subscribe: state.subscribe };

export function hasConfirmationSubscriber() {
  return subscriberCount > 0;
}

export function requestConfirmation(options = {}) {
  const config = typeof options === 'string' ? { message: options } : options;
  const { title = 'Confirm action', message, confirmLabel = 'Confirm', danger = false, requireText = '' } = config;
  return new Promise((resolve) => {
    active = { resolve };
    state.set({ title, message: String(message || ''), confirmLabel, danger, requireText: String(requireText || '') });
  });
}

export function resolveConfirmation(confirmed) {
  const pending = active;
  active = null;
  state.set(null);
  pending?.resolve(Boolean(confirmed));
}

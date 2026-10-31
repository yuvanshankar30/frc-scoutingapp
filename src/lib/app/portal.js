// Svelte action: moves an element to <body>, so a popup is positioned against the window
// and cannot be clipped or shifted by a parent that has overflow or a transform.
export function portal(node) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    }
  };
}

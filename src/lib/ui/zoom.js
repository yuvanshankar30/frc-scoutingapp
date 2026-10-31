// On desktop the whole app is drawn at 75% (CSS `zoom` on <html>, see app.css), as if the browser zoom were 75%;
// phones and narrow windows are drawn at 100%. Layout measurements from getBoundingClientRect(), innerWidth/innerHeight
// and pointer events are in real screen pixels, while `left`, `top` and sizes written back into styles are in zoomed
// pixels, so positions set from them go through here.
export function uiZoom() {
  if (typeof document === 'undefined') return 1;
  const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom'));
  return zoom > 0 ? zoom : 1;
}

export function viewportRect(element) {
  const rect = element.getBoundingClientRect();
  const zoom = uiZoom();
  return {
    left: rect.left / zoom,
    right: rect.right / zoom,
    top: rect.top / zoom,
    bottom: rect.bottom / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom
  };
}

export function viewportSize() {
  const zoom = uiZoom();
  return { width: window.innerWidth / zoom, height: window.innerHeight / zoom };
}

/** A pointer coordinate (clientX or clientY) in the zoomed pixels that `left`/`top` use. */
export const zoomed = (screenPixels) => screenPixels / uiZoom();

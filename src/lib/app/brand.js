// Puts the team's brand color on the page. The CSS variables are set on <html> itself, so they win over the
// theme's own accent colors in app.css and calm.css for both light and dark.
import { brandCssVars } from '$lib/app/teamSettings.js';

export function applyBrand(brandColor, theme) {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  for (const [name, color] of Object.entries(brandCssVars(brandColor, theme))) style.setProperty(name, color);
}

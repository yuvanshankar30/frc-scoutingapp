// Previews the team's brand color and appearance while Team settings is open. The CSS variables are set on <html>
// itself, so they win over the theme's tokens and the saved look in the page head. clearBrand() removes them again,
// so the saved look (which follows the theme) takes over once the preview ends.
import { brandCssVars } from '$lib/app/teamSettings.js';
import { appearanceCssVars } from '$lib/app/appearance.js';

let previewed = [];

export function applyBrand(brandColor, theme, appearance = null) {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  const vars = {
    ...(appearance ? appearanceCssVars(appearance, theme, brandColor) : {}),
    ...brandCssVars(brandColor, theme)
  };
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
  previewed = Object.keys(vars);
}

export function clearBrand() {
  if (typeof document === 'undefined') return;
  for (const name of previewed) document.documentElement.style.removeProperty(name);
  previewed = [];
}

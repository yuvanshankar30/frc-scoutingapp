// How the app looks, beyond the brand color: the surface palette, a second color, fonts, corners, the logo badge,
// a tagline and a few switches. An admin picks them in Scouting Admin > Team settings; they live in the
// app_settings.appearance JSON column. This module is the one place that checks them and turns them into CSS
// custom properties, in the browser, on the server and in scripts/admin.mjs. It has no imports on purpose.

const text = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

const HEX = /^#[0-9a-f]{6}$/i;
const hexOrEmpty = (value) => {
  const raw = String(value ?? '').trim();
  const expanded = /^#[0-9a-f]{3}$/i.test(raw) ? `#${[...raw.slice(1)].map((c) => c + c).join('')}` : raw;
  return HEX.test(expanded) ? expanded.toLowerCase() : '';
};

// Each palette is its dark and light surfaces: page background, three surface steps, border, body text, headings
// and muted text. Semantic colors (green for success, red for failure) stay the same in every palette.
export const PALETTES = Object.freeze([
  {
    key: 'ink',
    label: 'Ink and cream',
    dark: ['#0d0b09', '#16120e', '#1e1913', '#272019', '#2e271f', '#d9d1c4', '#f4ede2', '#8f8677'],
    light: ['#f4ede2', '#fbf7f0', '#efe7d9', '#e6dccb', '#ddd3c3', '#2a241c', '#0d0b09', '#6f675b']
  },
  {
    key: 'graphite',
    label: 'Graphite',
    dark: ['#0b0c0e', '#141518', '#1b1d21', '#23262b', '#2c2f35', '#d4d7dd', '#f5f6f8', '#8b9099'],
    light: ['#eef0f3', '#ffffff', '#f4f5f7', '#e8eaee', '#d6d9df', '#22252b', '#0b0c0e', '#626873']
  },
  {
    key: 'midnight',
    label: 'Midnight',
    dark: ['#070b16', '#0e1424', '#141c30', '#1b243b', '#25304a', '#cfd8ec', '#f1f5ff', '#7f8bab'],
    light: ['#e9eef8', '#ffffff', '#f2f5fb', '#e3e9f5', '#cfd8ea', '#17213f', '#070b16', '#5b6a8f']
  },
  {
    key: 'forest',
    label: 'Forest',
    dark: ['#08100c', '#0f1a14', '#15221a', '#1c2b22', '#26372c', '#cfdcd2', '#eef6f0', '#7f9486'],
    light: ['#eaf1ec', '#fbfdfb', '#f0f5f1', '#e2ebe5', '#cddbd2', '#1a2a20', '#08100c', '#5a6e61']
  },
  {
    key: 'plum',
    label: 'Plum',
    dark: ['#0f0a12', '#18111d', '#201726', '#291e30', '#33263b', '#ddd2e3', '#f7f0fa', '#94859c'],
    light: ['#f2ecf4', '#fdfbfe', '#f5f0f7', '#ebe2ef', '#dccfe2', '#2a1f30', '#0f0a12', '#6e6076']
  },
  {
    key: 'ember',
    label: 'Ember',
    dark: ['#110807', '#1b0f0d', '#241512', '#2e1b17', '#3a241f', '#e6d3cd', '#fbf0ec', '#9c8580'],
    light: ['#f6ece8', '#fffbf9', '#f8f0ec', '#efe2dc', '#e2cfc7', '#2f1f1b', '#110807', '#76625c']
  }
]);

export const FONTS = Object.freeze([
  {
    key: 'grotesk',
    label: 'Space Grotesk',
    body: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  },
  {
    key: 'inter',
    label: 'Inter',
    body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  },
  {
    key: 'barlow',
    label: 'Barlow (condensed headings)',
    body: "'Barlow', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "'Barlow Condensed', 'Barlow', -apple-system, BlinkMacSystemFont, sans-serif"
  },
  {
    key: 'serif',
    label: 'Serif headings',
    body: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    display: "'Instrument Serif', Georgia, 'Times New Roman', serif"
  },
  {
    key: 'system',
    label: 'System',
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    display: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  }
]);

export const CORNERS = Object.freeze([
  { key: 'round', label: 'Round', radius: [4, 8, 10, 14, 18], button: '999px' },
  { key: 'soft', label: 'Soft', radius: [3, 5, 6, 8, 10], button: '8px' },
  { key: 'square', label: 'Square', radius: [1, 2, 2, 3, 3], button: '2px' }
]);

export const MARK_SHAPES = Object.freeze([
  { key: 'rounded', label: 'Rounded square' },
  { key: 'circle', label: 'Circle' },
  { key: 'square', label: 'Square' }
]);

export const MARK_STYLES = Object.freeze([
  { key: 'outline', label: 'Outline' },
  { key: 'filled', label: 'Filled' },
  { key: 'ink', label: 'Ink' }
]);

export const DEFAULT_APPEARANCE = Object.freeze({
  palette: 'ink',
  secondaryColor: '',
  font: 'grotesk',
  corners: 'round',
  markShape: 'rounded',
  markStyle: 'ink',
  markText: '',
  tagline: '',
  serifAccent: true,
  glow: true
});

const keyIn = (list, value, fallback) => (list.some((item) => item.key === value) ? value : fallback);

/** The appearance as the app uses it, from the stored JSON (or what an admin submitted). Always complete. */
export function normalizeAppearance(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = DEFAULT_APPEARANCE;
  return {
    palette: keyIn(PALETTES, value.palette, d.palette),
    secondaryColor: hexOrEmpty(value.secondaryColor ?? value.secondary_color),
    font: keyIn(FONTS, value.font, d.font),
    corners: keyIn(CORNERS, value.corners, d.corners),
    markShape: keyIn(MARK_SHAPES, value.markShape ?? value.mark_shape, d.markShape),
    markStyle: keyIn(MARK_STYLES, value.markStyle ?? value.mark_style, d.markStyle),
    markText: text(value.markText ?? value.mark_text, 4),
    tagline: text(value.tagline, 80),
    serifAccent: (value.serifAccent ?? value.serif_accent ?? d.serifAccent) ? true : false,
    glow: (value.glow ?? d.glow) ? true : false
  };
}

/** What gets stored: the normalized appearance in snake_case keys. */
export function appearanceColumn(raw) {
  const a = normalizeAppearance(raw);
  return {
    palette: a.palette,
    secondary_color: a.secondaryColor,
    font: a.font,
    corners: a.corners,
    mark_shape: a.markShape,
    mark_style: a.markStyle,
    mark_text: a.markText,
    tagline: a.tagline,
    serif_accent: a.serifAccent,
    glow: a.glow
  };
}

/**
 * CSS custom properties for the appearance in one theme ('modern' is light, 'modern-dark' dark). `accent` is the
 * brand color, used when no second color is set.
 */
export function appearanceCssVars(raw, theme, accent = '') {
  const a = normalizeAppearance(raw);
  const palette = PALETTES.find((item) => item.key === a.palette);
  const [bg, s1, s2, s3, border, body, strong, muted] = theme === 'modern' ? palette.light : palette.dark;
  const font = FONTS.find((item) => item.key === a.font);
  const corners = CORNERS.find((item) => item.key === a.corners);
  const second = a.secondaryColor || accent || 'currentColor';
  const glowColor = a.secondaryColor || 'var(--accent)';
  return {
    '--color-white': s1,
    '--color-black': strong,
    '--neutral-100': s2,
    '--neutral-300': border,
    '--neutral-500': muted,
    '--neutral-800': body,
    '--primary': s1,
    '--secondary': strong,
    '--background': bg,
    '--card': s1,
    '--surface-1': s1,
    '--surface-2': s2,
    '--surface-3': s3,
    '--text': body,
    '--text-strong': strong,
    '--text-secondary': muted,
    '--text-muted': muted,
    '--muted': muted,
    '--muted-bg': s2,
    '--border': border,
    '--divider': border,
    '--font-body': font.body,
    '--font-display': font.display,
    '--radius-xs': `${corners.radius[0]}px`,
    '--radius-sm': `${corners.radius[1]}px`,
    '--radius-md': `${corners.radius[2]}px`,
    '--radius-lg': `${corners.radius[3]}px`,
    '--radius-xl': `${corners.radius[4]}px`,
    '--btn-radius-default': corners.button,
    '--accent-2': second,
    '--app-glow': a.glow
      ? `radial-gradient(1100px 620px at 88% -8%, color-mix(in srgb, ${glowColor} 9%, transparent), transparent 70%)`
      : 'none'
  };
}

/** The text in the logo badge when there is no logo: the chosen text, else the team number, else the app's initial. */
export function markLabel(appearance, settings) {
  const a = normalizeAppearance(appearance);
  return (
    a.markText || (settings?.teamNumber ? String(settings.teamNumber) : (settings?.appShortName || 'S').slice(0, 1))
  );
}

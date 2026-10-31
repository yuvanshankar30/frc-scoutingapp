// The team's own settings: who the app belongs to and how it looks. They are chosen once in first-run setup
// (/setup) and can be changed later by an admin under Scouting Admin > Team settings. One row in the
// app_settings table holds them; this module is the single place that reads, checks and applies them, in the
// browser and on the server alike.

export const DEFAULT_BRAND_COLOR = '#2563eb';
/** Quick picks in the settings form; any color can be chosen as well. */
export const PRESET_BRAND_COLORS = Object.freeze([
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#f59e0b',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#ea580c'
]);
export const DEFAULT_THEME = 'dark';
export const THEME_CHOICES = ['dark', 'light'];

// Pages a team can switch off in Team settings. Hidden pages drop out of the menu; their addresses still work
// for anyone who has them bookmarked. Keys match the menu items in navigation.js.
export const OPTIONAL_FEATURES = Object.freeze([
  { key: 'pitcrew', label: 'Pit Crew', blurb: 'Robot failure tickets for your own robot' },
  { key: 'driveteam', label: 'Drive Team', blurb: "Your team's schedule and standings" },
  { key: 'predictions', label: 'Predictions', blurb: 'The match prediction game' },
  { key: 'assistant', label: 'Ask the data', blurb: 'AI questions about the scouting data (needs an API key)' },
  { key: 'bluealliance', label: 'Blue Alliance', blurb: 'Team and event lookups' },
  { key: 'epa', label: 'EPA', blurb: 'Statbotics-style expected points' }
]);
const OPTIONAL_FEATURE_KEYS = new Set(OPTIONAL_FEATURES.map((feature) => feature.key));

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_TEAM_NUMBER = 99999;

const text = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

/** "frc254", " 254 ", 254 -> 254; anything else -> null. */
export function parseTeamNumber(value) {
  const match = /^(?:frc)?(\d{1,5})$/i.exec(String(value ?? '').trim());
  const number = match ? Number(match[1]) : NaN;
  return Number.isInteger(number) && number > 0 && number <= MAX_TEAM_NUMBER ? number : null;
}

export function normalizeHexColor(value, fallback = DEFAULT_BRAND_COLOR) {
  const raw = String(value ?? '').trim();
  const expanded = /^#[0-9a-f]{3}$/i.test(raw) ? `#${[...raw.slice(1)].map((c) => c + c).join('')}` : raw;
  return HEX_COLOR.test(expanded) ? expanded.toLowerCase() : fallback;
}

/** The settings as the app uses them, from an app_settings row (or null when the site is not set up yet). */
export function normalizeTeamSettings(row) {
  if (!row || !parseTeamNumber(row.team_number)) return null;
  const teamNumber = parseTeamNumber(row.team_number);
  const teamName = text(row.team_name, 80);
  const otherTeams = [...new Set((row.other_team_numbers || []).map(parseTeamNumber).filter(Boolean))].filter(
    (number) => number !== teamNumber
  );
  return {
    configured: Boolean(row.setup_completed_at),
    teamNumber,
    teamKey: `frc${teamNumber}`,
    teamName,
    otherTeamNumbers: otherTeams,
    appName: text(row.app_name, 40) || `${teamNumber} Scouting`,
    appShortName: text(row.app_short_name, 16) || 'Scouting',
    brandColor: normalizeHexColor(row.brand_color),
    defaultTheme: THEME_CHOICES.includes(row.default_theme) ? row.default_theme : DEFAULT_THEME,
    timeZone: text(row.time_zone, 64) || 'UTC',
    logoUrl: typeof row.logo_url === 'string' && /^https?:\/\//.test(row.logo_url) ? row.logo_url : '',
    hiddenFeatures: (row.hidden_features || []).filter((key) => OPTIONAL_FEATURE_KEYS.has(key)),
    allowSignUp: row.allow_sign_up !== false
  };
}

/**
 * Checks what an admin (or first-run setup) submitted. Returns { value, error }: value holds app_settings
 * columns ready to write. `isValidTimeZone` comes from timezone.js; it is passed in so this file stays free of
 * imports.
 */
export function validateTeamSettingsInput(input = {}, { isValidTimeZone = () => true } = {}) {
  const teamNumber = parseTeamNumber(input.teamNumber);
  if (!teamNumber) return { value: null, error: 'Enter your FRC team number (1 to 99999).' };
  const teamName = text(input.teamName, 80);
  if (!teamName) return { value: null, error: 'Enter your team name.' };
  const rawOthers = Array.isArray(input.otherTeamNumbers)
    ? input.otherTeamNumbers
    : String(input.otherTeamNumbers ?? '')
        .split(/[\s,]+/)
        .filter(Boolean);
  const others = rawOthers.map(parseTeamNumber);
  if (others.some((number) => number === null))
    return { value: null, error: 'Other teams must be team numbers, like 1234.' };
  if (others.length > 10) return { value: null, error: 'List at most 10 other teams.' };
  const brandColor = String(input.brandColor ?? '').trim();
  if (brandColor && normalizeHexColor(brandColor, null) === null)
    return { value: null, error: 'The brand color must be a hex color like #2563eb.' };
  const timeZone = text(input.timeZone, 64) || 'UTC';
  if (!isValidTimeZone(timeZone)) return { value: null, error: 'Pick a timezone from the list.' };
  const defaultTheme = THEME_CHOICES.includes(input.defaultTheme) ? input.defaultTheme : DEFAULT_THEME;
  const hidden = Array.isArray(input.hiddenFeatures) ? input.hiddenFeatures.map(String) : [];
  return {
    error: null,
    value: {
      team_number: teamNumber,
      team_name: teamName,
      other_team_numbers: [...new Set(others)].filter((number) => number !== teamNumber),
      app_name: text(input.appName, 40) || `${teamNumber} Scouting`,
      app_short_name: text(input.appShortName, 16) || 'Scouting',
      brand_color: normalizeHexColor(brandColor),
      default_theme: defaultTheme,
      time_zone: timeZone,
      hidden_features: [...new Set(hidden.filter((key) => OPTIONAL_FEATURE_KEYS.has(key)))],
      allow_sign_up: input.allowSignUp !== false
    }
  };
}

/** Team numbers a member can compete for: the main team first, then the others, then Mentor. */
export function competitionTeamChoices(settings) {
  if (!settings) return ['Mentor'];
  return [String(settings.teamNumber), ...settings.otherTeamNumbers.map(String), 'Mentor'];
}

const channel = (hex, index) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
const toHex = (values) =>
  `#${values
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
const mix = (hex, target, amount) => toHex([0, 1, 2].map((i) => channel(hex, i) + (target - channel(hex, i)) * amount));

function luminance(hex) {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const c = channel(hex, i) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads better on `hex`. */
export function readableTextOn(hex) {
  const color = normalizeHexColor(hex);
  return (luminance(color) + 0.05) / 0.05 >= 1.05 / (luminance(color) + 0.05) ? '#0b0b0b' : '#ffffff';
}

/**
 * The CSS custom properties that carry the brand color, for the given theme ('modern' is light, 'modern-dark'
 * dark). They override the theme's accent tokens in app.css and calm.css, so every button, highlight and chart
 * accent follows the team's color.
 */
export function brandCssVars(brandColor, theme) {
  const base = normalizeHexColor(brandColor);
  const dark = theme !== 'modern';
  const strong = dark ? mix(base, 255, 0.45) : mix(base, 0, 0.45);
  const soft = dark ? mix(base, 0, 0.72) : mix(base, 255, 0.82);
  const contrast = readableTextOn(base);
  return {
    '--brand-gold-base': base,
    '--brand-gold-strong': strong,
    '--brand-gold-soft': soft,
    '--accent': base,
    '--accent-strong': strong,
    '--accent-subtle': soft,
    '--accent-contrast': contrast,
    '--on-primary': contrast
  };
}

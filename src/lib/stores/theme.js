import { writable } from 'svelte/store';
import { browser } from '$app/environment';

// Light ('modern') or dark ('modern-dark'). Each person's choice is saved on their profile (theme_preference);
// until they pick one, the team's default from Team settings applies. 'scouting-theme' in local storage only
// remembers the last one for the first paint (app.html), before the account is known.
const STORAGE_KEY = 'scouting-theme';
const DEFAULT_THEME = 'modern-dark';

export const THEMES = ['modern', 'modern-dark'];

export const THEME_LABELS = {
  modern: 'Light',
  'modern-dark': 'Dark'
};

// The navy and cyan "pit board" look kept in competition.css: a style layered over either theme rather than a
// theme of its own. Not offered in the UI; the brand color from Team settings is the way to restyle the app.
const STYLE_STORAGE_KEY = 'scouting-style';
const DEFAULT_STYLE = 'standard';
export const STYLES = ['standard', 'pit-board'];

export const STYLE_LABELS = {
  standard: 'Standard',
  'pit-board': 'Pit board'
};

function savedTheme() {
  if (!browser) return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

export const theme = writable(savedTheme() || DEFAULT_THEME);

function applyTheme(value) {
  if (!browser) return;
  const next = THEMES.includes(value) ? value : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private browsing */
  }
}

if (browser) {
  theme.subscribe(applyTheme);
}

export function setTheme(value) {
  theme.set(THEMES.includes(value) ? value : DEFAULT_THEME);
}

/** 'dark' | 'light' (Team settings) -> the theme name used here. */
export const themeForTeamDefault = (defaultTheme) => (defaultTheme === 'light' ? 'modern' : 'modern-dark');

/** Before anyone is signed in: the theme this device last used, else the team's default. */
export function applyTeamDefaultTheme(defaultTheme) {
  if (!savedTheme()) setTheme(themeForTeamDefault(defaultTheme));
}

/** A signed-in person's saved preference wins; with none saved, the team's default applies. */
export function followProfileTheme(preference, teamDefaultTheme) {
  setTheme(THEMES.includes(preference) ? preference : themeForTeamDefault(teamDefaultTheme));
}

export const style = writable(DEFAULT_STYLE);

function applyStyle(value) {
  if (!browser) return;
  const next = STYLES.includes(value) ? value : DEFAULT_STYLE;
  if (next === DEFAULT_STYLE) document.documentElement.removeAttribute('data-style');
  else document.documentElement.setAttribute('data-style', next);
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, next);
  } catch {
    /* private browsing */
  }
}

if (browser) {
  style.subscribe(applyStyle);
}

export function setStyle(value) {
  style.set(STYLES.includes(value) ? value : DEFAULT_STYLE);
}

export function toggleTheme() {
  theme.update((value) => (value === 'modern-dark' ? 'modern' : 'modern-dark'));
}

import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import {
  followProfileTheme,
  setStyle,
  setTheme,
  style,
  STYLES,
  theme,
  THEMES,
  themeForTeamDefault,
  toggleTheme
} from './theme.js';

describe('app theme', () => {
  it('offers dark and light, defaulting to dark', () => {
    expect(THEMES).toEqual(['modern', 'modern-dark']);
    expect(get(theme)).toBe('modern-dark');
  });

  it('falls back to dark for a theme name it does not know', () => {
    setTheme('something-else');
    expect(get(theme)).toBe('modern-dark');
  });

  it('switches between light and dark', () => {
    setTheme('modern');
    toggleTheme();
    expect(get(theme)).toBe('modern-dark');
    toggleTheme();
    expect(get(theme)).toBe('modern');
  });

  it("uses a person's saved theme, else the team's default", () => {
    expect(themeForTeamDefault('light')).toBe('modern');
    expect(themeForTeamDefault('dark')).toBe('modern-dark');
    followProfileTheme(null, 'light');
    expect(get(theme)).toBe('modern');
    followProfileTheme('modern-dark', 'light');
    expect(get(theme)).toBe('modern-dark');
  });

  it('uses the standard look by default, with the pit board kept as an optional style', () => {
    expect(STYLES).toEqual(['standard', 'pit-board']);
    expect(get(style)).toBe('standard');
    setStyle('pit-board');
    expect(get(style)).toBe('pit-board');
    setStyle('something-else');
    expect(get(style)).toBe('standard');
  });
});

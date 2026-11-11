import { describe, expect, it } from 'vitest';
import { appearanceColumn, appearanceCssVars, mixHex, normalizeAppearance, surfacesFrom } from './appearance.js';

describe('appearance colors', () => {
  it('keeps optional colors and backgrounds only when they are real hex colors', () => {
    const a = normalizeAppearance({ tertiary_color: '#ABC', background_dark: 'red', backgroundLight: '#ffffff' });
    expect(a).toMatchObject({ tertiaryColor: '#aabbcc', backgroundDark: '', backgroundLight: '#ffffff' });
    expect(appearanceColumn(a)).toMatchObject({ tertiary_color: '#aabbcc', background_light: '#ffffff' });
  });

  it('builds surfaces a step away from a custom background, with readable text', () => {
    const [bg, s1, , , , , strong] = surfacesFrom('#101820');
    expect(bg).toBe('#101820');
    expect(s1).toBe(mixHex('#101820', '#ffffff', 0.05));
    expect(strong).toBe('#f6f4f0');
    expect(surfacesFrom('#f0f0f0')[6]).toBe('#0d0b09');
  });

  it('uses the custom background for its theme only', () => {
    const look = { palette: 'ink', backgroundDark: '#101820' };
    expect(appearanceCssVars(look, 'modern-dark')['--background']).toBe('#101820');
    expect(appearanceCssVars(look, 'modern')['--background']).toBe('#f4ede2');
  });
});

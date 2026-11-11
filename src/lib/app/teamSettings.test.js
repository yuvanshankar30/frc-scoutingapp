import { describe, expect, it } from 'vitest';
import {
  brandCssVars,
  competitionTeamChoices,
  normalizeHexColor,
  normalizeTeamSettings,
  parseTeamNumber,
  readableTextOn,
  validateTeamSettingsInput
} from './teamSettings.js';

const valid = {
  teamNumber: '1234',
  teamName: 'Robo Raptors',
  otherTeamNumbers: '5678, frc9012',
  brandColor: '#ABC',
  timeZone: 'America/Chicago',
  defaultTheme: 'light',
  hiddenFeatures: ['assistant', 'not-a-page'],
  allowSignUp: false
};

describe('team settings', () => {
  it('reads team numbers in every form people type them', () => {
    expect(parseTeamNumber('254')).toBe(254);
    expect(parseTeamNumber(' frc254 ')).toBe(254);
    expect(parseTeamNumber(254)).toBe(254);
    expect(parseTeamNumber('0')).toBeNull();
    expect(parseTeamNumber('254a')).toBeNull();
    expect(parseTeamNumber('123456')).toBeNull();
  });

  it('accepts short and long hex colors and nothing else', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor('#2563EB')).toBe('#2563eb');
    expect(normalizeHexColor('red', null)).toBeNull();
    expect(normalizeHexColor('url(x)', null)).toBeNull();
  });

  it('turns form input into database columns', () => {
    const { value, error } = validateTeamSettingsInput(valid, { isValidTimeZone: () => true });
    expect(error).toBeNull();
    expect(value).toMatchObject({
      team_number: 1234,
      team_name: 'Robo Raptors',
      other_team_numbers: [5678, 9012],
      app_name: '1234 Scouting',
      app_short_name: 'Scouting',
      brand_color: '#aabbcc',
      default_theme: 'light',
      time_zone: 'America/Chicago',
      hidden_features: ['assistant'],
      allow_sign_up: false
    });
  });

  it('says what is wrong instead of saving bad input', () => {
    const check = (patch, isValidTimeZone = () => true) =>
      validateTeamSettingsInput({ ...valid, ...patch }, { isValidTimeZone }).error;
    expect(check({ teamNumber: 'abc' })).toMatch(/team number/);
    expect(check({ teamName: '  ' })).toMatch(/team name/);
    expect(check({ otherTeamNumbers: '12, nope' })).toMatch(/Other teams/);
    expect(check({ brandColor: 'blue' })).toMatch(/hex color/);
    expect(check({}, () => false)).toMatch(/timezone/);
  });

  it('gives defaults before an admin sets the team', () => {
    const settings = normalizeTeamSettings({ id: 1, team_number: null, team_name: '' });
    expect(settings).toMatchObject({ configured: false, teamNumber: null, teamKey: '', appName: 'FRC Scouting' });
    expect(competitionTeamChoices(settings)).toEqual(['Mentor']);
  });

  it('reads an app_settings row, and treats a missing one as not set up', () => {
    expect(normalizeTeamSettings(null)).toBeNull();
    const row = {
      team_number: 1234,
      team_name: 'Robo Raptors',
      other_team_numbers: [5678, 1234],
      brand_color: 'not-a-color',
      default_theme: 'neon',
      logo_url: 'javascript:alert(1)',
      hidden_features: ['epa', 'bogus'],
      setup_completed_at: null
    };
    const settings = normalizeTeamSettings(row);
    expect(settings).toMatchObject({
      configured: true,
      teamKey: 'frc1234',
      otherTeamNumbers: [5678],
      brandColor: '#2563eb',
      defaultTheme: 'dark',
      logoUrl: '',
      hiddenFeatures: ['epa'],
      allowSignUp: true
    });
  });

  it('offers the main team first, then the others, then Mentor', () => {
    expect(competitionTeamChoices({ teamNumber: 1234, otherTeamNumbers: [5678] })).toEqual(['1234', '5678', 'Mentor']);
    expect(competitionTeamChoices(null)).toEqual(['Mentor']);
  });

  it('derives readable accent colors for both themes', () => {
    expect(readableTextOn('#ffffff')).toBe('#0b0b0b');
    expect(readableTextOn('#1d4ed8')).toBe('#ffffff');
    const dark = brandCssVars('#2563eb', 'modern-dark');
    const light = brandCssVars('#2563eb', 'modern');
    expect(dark['--accent']).toBe('#2563eb');
    expect(dark['--accent-strong']).not.toBe(light['--accent-strong']);
    for (const value of Object.values(dark)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});

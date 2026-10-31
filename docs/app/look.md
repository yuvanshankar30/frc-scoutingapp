# Look and theme

Dark-first, with a light theme each person can switch to. Colors, spacing and type come from the tokens in
`src/app.css` and `src/calm.css`; components never hard-code a color (`src/lib/ui/siteControls.test.js` checks).

The team's **brand color** from [Team settings](../scouting-admin/team-settings.md) replaces the theme's accent: the
root layout writes `--accent`, `--accent-strong`, `--accent-subtle`, `--accent-contrast` (and the `--brand-gold-*`
tokens the older styles use) for both themes into the page head, worked out by `brandCssVars()` in
`src/lib/app/teamSettings.js` so text on the accent stays readable. Field drawings use the `--field-*` and
`--alliance-*` tokens, which stay the same in every theme.

On desktop the whole UI is drawn at 75%, as if the browser zoom were 75%; touch screens always get the full-size UI.
Content that replaces a loading state animates in.

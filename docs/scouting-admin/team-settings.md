# Team settings

Scouting Admin > Team settings (`/scouting-admin/team`) holds the team's settings. Admins and the Competition Lead can
save; everyone else sees them read-only. Until a team is set, admins see a reminder at the top of every page.

The same settings can be set from the command line, which is how a new site gets its team before anyone signs in:

```sh
npm run admin -- set-team --number 1234 --name "Robo Raptors" [--app-name ...] [--short-name ...] [--color "#2563eb"] \
  [--theme dark|light] [--timezone America/Chicago] [--other-teams "5678,9012"] [--sign-up on|off] [--hide "assistant"]
npm run admin -- show
```

`scripts/admin.mjs` uses the service key from `.env` and the same checks as this page. It also makes the first admin
(`create-admin --email ... --password ...`) and approves accounts (`approve --email ...`).

| Setting | What it changes |
| --- | --- |
| Team number | "Our team" everywhere: Home's next match and standing, Drive Team, Strategy Board's "Us" row, Picklist insights, the events offered in Event setup, the AI assistant's "we" |
| Team name | The sign-in page and the assistant |
| Other teams | Extra teams people can be put on for an event (People tab), and their events in Event setup |
| App name, short name | The menu, the sign-in page, the browser tab and the home-screen icon name |
| Logo | The menu, the sign-in page and the installed app icon (PNG, JPEG or WebP, up to 256 KB). Without one, the team number is shown in the brand color |
| Brand color | Buttons, highlights, the active menu item and accents, in both themes (lighter and darker shades are worked out from it) |
| Default theme | What new devices and people who haven't picked a theme see. Each person can switch for themselves |
| Timezone | Match times, "today" in exports, Slack reminders |
| Pages in the menu | Hide optional pages: Drive Team, AI analytics, Blue Alliance, EPA. Hidden pages leave the menu; their addresses still work |
| Let people create their own accounts | Shows or hides "Create an account" on the sign-in page (see [sign-in](../app/sign-in.md#creating-an-account)) |

Changes take effect for everyone the next time they load the site (the server caches settings for 30 seconds).

## Code

`src/lib/components/settings/TeamSettingsPanel.svelte` and `TeamSettingsForm.svelte` (shared with setup),
`src/routes/api/team-settings/+server.js` (saving and the logo upload to the `branding` bucket),
`src/lib/app/teamSettings.js` (validation and brand colors), `src/lib/server/teamSettings.js` (reading and caching),
table `app_settings`.

## Appearance

Team settings > Appearance sets the look beyond the brand color, with a live preview at the top of the section.
Everything is stored in `app_settings.appearance` (one JSON object) and checked in `src/lib/app/appearance.js`, which
also turns it into the CSS variables the page head carries for both themes.

| Setting | Choices |
| --- | --- |
| Palette | Ink and cream, Graphite, Midnight, Forest, Plum, Ember: page and card colors for dark and light |
| Secondary color | Optional: the serif word in the app name and the background glow (the brand color when empty) |
| Highlight color | Optional: the second series in charts (the secondary color when empty) |
| Dark / light background | Optional, per theme: the page background; cards, borders and text colors are built from it |
| Font | Space Grotesk, Inter, Barlow (condensed headings), serif headings, system |
| Corners | Round, soft, square |
| Badge | Shape (rounded square, circle, square), style (ink, outline, filled) and text (up to 4 characters, the team number by default); shown when there is no logo |
| Tagline | Up to 80 characters, under the app name on the sign-in page |
| Switches | Serif accent in the app name; background glow |

Every color field opens a picker with a color wheel, a brightness slider, R / G / B and hex fields, and quick picks
(`src/lib/components/common/ColorPicker.svelte`). The page shows each change as you make it; nothing is saved until
**Save settings**.

**Default theme** is what everyone sees until they switch theme themselves (the sun / moon button). Picking it here
shows it straight away; **Use it for me too** drops your own choice so the team default applies to you as well.

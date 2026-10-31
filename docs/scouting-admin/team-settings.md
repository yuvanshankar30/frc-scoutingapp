# Team settings

Scouting Admin > Team settings (`/scouting-admin/team`) changes what [first-run setup](../app/first-run-setup.md)
chose. Admins and the Competition Lead can save; everyone else sees the settings read-only.

| Setting | What it changes |
| --- | --- |
| Team number | "Our team" everywhere: Home's next match and standing, Drive Team, Strategy Board's "Us" row, Picklist insights, the events offered in Event setup, the AI assistant's "we" |
| Team name | The sign-in page and the assistant |
| Other teams | Extra teams people can be put on for an event (People tab), and their events in Event setup |
| App name, short name | The menu, the sign-in page, the browser tab and the home-screen icon name |
| Logo | The menu, the sign-in page and the installed app icon (PNG, JPEG or WebP, up to 256 KB). Without one, the team number is shown in the brand color |
| Brand color | Buttons, highlights, the active menu item and accents, in both themes (lighter and darker shades are worked out from it) |
| Default theme | What new devices and people who haven't picked a theme see. Each person can switch for themselves |
| Timezone | Match times, deadlines, "today" in exports, Slack reminders |
| Pages in the menu | Hide optional pages: Pit Crew, Drive Team, Predictions, AI analytics, Blue Alliance, EPA. Hidden pages leave the menu; their addresses still work |
| Let people create their own accounts | Shows or hides "Create an account" on the sign-in page (see [sign-in](../app/sign-in.md#creating-an-account)) |

Changes take effect for everyone the next time they load the site (the server caches settings for 30 seconds).

## Code

`src/lib/components/settings/TeamSettingsPanel.svelte` and `TeamSettingsForm.svelte` (shared with setup),
`src/routes/api/team-settings/+server.js` (saving and the logo upload to the `branding` bucket),
`src/lib/app/teamSettings.js` (validation and brand colors), `src/lib/server/teamSettings.js` (reading and caching),
table `app_settings`.

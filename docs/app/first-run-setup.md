# First-run setup

The first time the site runs, it has no team and no admin. Until setup is done, every page goes to `/setup`
(`hooks.server.js`), which asks for:

| Section | What you enter |
| --- | --- |
| Team | Team number, team name, and any other teams your members compete for (sister or rookie teams) |
| Look | App name and short name (home screen), brand color (presets or any color), default theme (dark or light) |
| Event days | The timezone events run in, which optional pages appear in the menu, and whether people may create their own accounts |
| Your admin account | Your name, email and password, and the **setup token** |

The page previews the brand color and theme as you choose them. When you finish, you are signed in as the site's first
admin and land on Home. Everything except the admin account can be changed later in
[Scouting Admin > Team settings](../scouting-admin/team-settings.md).

## The setup token

`SETUP_TOKEN` is a secret in the server's environment (see [.env.example](../../.env.example)). Setup only finishes for
someone who types it, so a stranger who finds a freshly deployed site first can't make themselves its admin. If it is
not set, the setup page says so and refuses to continue. Once setup is done, `/api/setup` refuses every request, and the
token can be removed.

## What happens

`POST /api/setup` (`src/routes/api/setup/+server.js`):

1. Checks the token (constant-time comparison, `src/lib/server/setup.js`) and limits attempts per address.
2. Validates the team settings (`validateTeamSettingsInput` in `src/lib/app/teamSettings.js`) and the admin account.
3. Creates the `app_settings` row. It can only be created once, so if two people set up at the same moment, only one
   gets through.
4. Creates the admin's account (email already confirmed) and makes it `role = 'admin'`, approved.
5. Marks setup finished. If any step fails, the settings row is removed again so setup can be retried.

`GET /api/setup` reports whether setup is done, whether the token is configured, and whether the database is reachable,
which the page uses to explain what is missing.

# Versions

Every change gets a version number and date, newest first. The current version is the top row; `package.json` carries
the same number. How to pick the number: [code conventions, "Versioning"](docs/development/conventions.md#versioning).

| Version | Date | What changed | Docs |
| --- | --- | --- | --- |
| V1.1.0 | 2026-10-31 | No first-run setup screen: the settings row exists from the start, admins set the team in Scouting Admin > Team settings (with a reminder until they do), and `npm run admin` makes the first admin, sets the team settings and approves accounts from the command line. `SETUP_TOKEN` is gone. | [Team settings](docs/scouting-admin/team-settings.md), [README](README.md) |
| V1.0.2 | 2026-10-31 | A fresh clone with no `.env` no longer crashes every page with "supabaseUrl is required": the Supabase clients use a stand-in address and the site says it is not connected to a database yet. | [Local development](docs/development/local-dev.md) |
| V1.0.1 | 2026-10-31 | Security fixes carried over from the source app: the AI assistant needs an approved account and every model call has an output cap; the public TBA proxies are rate limited per address; API answers are never cached; the Docker build skips install scripts; the profile guard's helper only answers for the caller, and server-only database functions can't be run by client roles (`20260102000000_security_followups.sql`). | [Security](docs/security/README.md), [Deployment](docs/architecture/deployment.md) |
| V1.0.0 | 2026-10-30 | First public release: a scouting app any FRC team can run and customize. First-run setup with a setup token; team, colors, logo, timezone and menu in Team settings; its own email and password sign-in with admin approval; a single baseline database schema. | [README](README.md), [Team settings](docs/scouting-admin/team-settings.md) |

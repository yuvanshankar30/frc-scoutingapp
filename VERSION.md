# Versions

Every change gets a version number and date, newest first. The current version is the top row; `package.json` carries
the same number. How to pick the number: [code conventions, "Versioning"](docs/development/conventions.md#versioning).

| Version | Date | What changed | Docs |
| --- | --- | --- | --- |
| V1.0.1 | 2026-10-31 | Security fixes carried over from the source app: the AI assistant needs an approved account and every model call has an output cap; the public TBA proxies are rate limited per address; API answers are never cached; the Docker build skips install scripts; the profile guard's helper only answers for the caller, and server-only database functions can't be run by client roles (`20260102000000_security_followups.sql`). | [Security](docs/security/README.md), [Deployment](docs/architecture/deployment.md) |
| V1.0.0 | 2026-10-30 | First public release: a scouting app any FRC team can run and customize. First-run setup with a setup token; team, colors, logo, timezone and menu in Team settings; its own email and password sign-in with admin approval; a single baseline database schema. | [README](README.md), [first-run setup](docs/app/first-run-setup.md), [Team settings](docs/scouting-admin/team-settings.md) |

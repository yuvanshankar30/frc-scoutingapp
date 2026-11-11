# FRC Scouting App

A scouting and match-analysis app for an FRC team at competition. Scouts record what robots do in matches and in the
pits from their phones, even with no signal, and the app turns that into team rankings, a strategy board, match
previews and a shared picklist for alliance selection.

It is built to be **made your own**: your team number, name, logo, colors, fonts, menu, roles and scouting forms are all
set from inside the app, with no code changes.

## What it does

- **Scout.** Match scouting in three kinds (data, performance and robot), pit scouting with photos, quick notes, each
  scout's own assignments, and an offline queue that sends reports once the phone is back online.
- **Analyze.** Team View with charts, a Strategy Board, Match View, power and match rankings, EPA ratings, and an
  optional AI assistant that answers questions about your scouting data.
- **On the field.** Your team's schedule for the drive team, a shared picklist, and Blue Alliance lookups.
- **Run the event.** Event setup, match and shift-based scouting assignments, editable scouting forms, people and roles
  with fine-grained permissions, an activity log of every change, and exports to Excel, CSV and Google Sheets.

The scouting form and field map follow the **2026 FRC game**. Each season's game lives in its own part of the code, so a
new game can be added next to the old one.

## Make it yours

Everything below is done by an admin on the site, under **Scouting Admin**:

| What | Where |
| --- | --- |
| Team number and name, sister teams | Team settings |
| App name, logo or badge, brand and secondary colors, palette, background, fonts, corners | Team settings > Appearance |
| Default light or dark theme (each person can still switch) | Team settings |
| Which optional pages appear in the menu | Team settings |
| Who can do what: build roles from permissions and give them to people | People > Roles |
| Who changed what, and when | People > Activity |
| Scouting questions and forms | Edit |
| Who scouts which robot, by match or by shift | Assignments |

Deeper changes, like a new season's game or a new kind of chart, are code changes; the [docs](docs/README.md) explain
where each part lives.

## What you need

- **A database.** The app stores its data, accounts and photos in [Supabase](https://supabase.com) (Postgres with
  sign-in and file storage built in). The free tier is plenty for one team. You can use Supabase's hosted service or
  run Supabase yourself, for example on a Google Cloud virtual machine.
- **A place to run it.** The app is a standard Node.js web server and also ships as a Docker image, so it runs almost
  anywhere: Google Cloud Run, Firebase App Hosting, Render, Fly.io, Railway, a school server, or a laptop in the pits.
- **A Blue Alliance API key** (free) for schedules, teams and results.
- **Optional:** a Slack bot for notifications, an AI API key for the assistant, and a Google service account for the
  Google Sheets export.

Two database files set everything up: one creates the tables, and one adds the security rules. The
[setup guide](docs/development/setup.md) and [deployment notes](docs/architecture/deployment.md) cover the details
for whoever runs the server.

## Who can see what

New accounts wait for an admin to approve them and can see nothing until then. Everyone approved is a **Member**: they
can scout and read the analysis pages. Anything more (setting up events, editing forms, exporting or deleting data,
managing people) comes from a **role** an admin builds out of permissions, and every change anyone makes is kept in the
activity log. The database itself enforces who can read and write what, so the rules hold even outside the app.

## Learn more

| Topic | Where |
| --- | --- |
| How every screen works | [docs/](docs/README.md) |
| What changed in each version | [docs/VERSION.md](docs/VERSION.md) |
| Security model | [docs/security/](docs/security/README.md) |
| Setting up the app | [docs/development/setup.md](docs/development/setup.md) |
| Running and deploying the server | [docs/architecture/deployment.md](docs/architecture/deployment.md) |

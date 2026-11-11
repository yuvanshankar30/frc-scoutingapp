# FRC Scouting App

A scouting and match-analysis app for FRC teams at competition. Scouts record what robots do in matches and in the pits
from their phones, even with no signal, and the app turns that into team rankings, a strategy board, match previews and
a shared picklist for alliance selection.

## What it does

- **Scout:** match scouting (data, performance and robot), pit scouting with photos, notes, and each scout's own
  assignments. Reports wait on the phone until it is back online.
- **Analyze:** Team View, Strategy Board, Match View, power and match rankings, EPA ratings, and an optional AI
  assistant.
- **On the field:** the drive team's schedule, a shared picklist, and Blue Alliance lookups.
- **Run the event:** event setup, match and shift assignments, a visual scouting form editor, roles and permissions, an
  activity log, and exports to Excel, CSV and Google Sheets.

## Make it yours

Your team, name, logo, colors, fonts, menu, roles and scouting forms are all set inside the app under
**Scouting Admin**, with no code changes. The scouting form is built in a drag-and-drop editor and can be exported and
imported as a file; the starting forms for each season live in [`scouting-forms/`](scouting-forms/README.md).

## Who can see what

New accounts see nothing until an admin approves them. Approved people are **Members**: they scout and read the
analysis pages. Anything more comes from a **role** an admin builds from permissions, and every change is kept in the
activity log. The database enforces these rules itself.

## More

- [Setting up the app](SETUP.md)
- [How every screen works](docs/README.md)
- [What changed in each version](docs/VERSION.md)
- [Security](docs/security/README.md)

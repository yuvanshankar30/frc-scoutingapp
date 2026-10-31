# Documentation

How the site works **now**, sorted by where things live in the site: one folder per menu group, one page per screen or
tab. For **when** something changed, see [VERSION.md](../VERSION.md).

New here? Start with the [README](../README.md) (setup and deployment), then
[first-run setup](app/first-run-setup.md).

| Folder | What's in it |
| --- | --- |
| [app/](app/README.md) | The shell around every page: first-run setup, Home, sign-in, Account, access, navigation, look, site controls, phone layout |
| [scouting/](scouting/README.md) | The **Scout** menu: Match Scouting, Pit Scouting, My Reports, assignment cards, Quick Scout, offline |
| [analysis/](analysis/README.md) | The **Analyze** menu: Team View, Strategy Board, Match View, rankings, EPA, AI analytics |
| [on-the-field/](on-the-field/README.md) | The **On the field** menu: Drive Team, Pit Crew, Picklist, Blue Alliance, Predictions |
| [scouting-admin/](scouting-admin/README.md) | Every **Scouting Admin** tab, including Team settings |
| [architecture/](architecture/README.md) | How it fits together: system overview, database, deployment |
| [development/](development/README.md) | For contributors: running it locally, testing, and how to document a change |
| [security/](security/README.md) | How accounts, data and secrets are protected |

## Every change is documented

Every pull request updates a page here (how-to: [development/documenting-changes.md](development/documenting-changes.md)):

| Change | Documentation |
| --- | --- |
| MAJOR (big feature or rollout) | A new or rewritten page or folder, listed here and in the folder's README |
| MINOR (new feature or noticeable change) | A new section on the page, or a new page for a new screen |
| PATCH fix | Correct whatever the fix made wrong |

A new screen gets a new page in its menu group's folder; a new menu group gets a new folder with a README.

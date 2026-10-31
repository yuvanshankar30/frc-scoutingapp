# Scouting Admin: Data

CSV export and sheet sync, then the submitted reports browsed by team, match, scout, or what needs a look, including
**Match numbers to review** (reports whose match box couldn't be converted to a match key).

## Scouting data export

One sheet with every scouting record for the event, written for people to sort, filter and analyze:
- Data, Performance and Robot reports
- pit scouting
- the scouts' match rankings
- scout notes
- pit problems

**Whole event** or **This day** (in the team's timezone), as **Excel** (colors and a guide) or **CSV** (the same table as plain
text). The file is called `scouting-<event>.xlsx` / `.csv`.

- **One row per record**, sorted by kind, then match, then team.
- **Plain column names**, grouped by form: Who, when · Data scouting · Performance scouting · Robot scouting · Pit
  scouting · Notes, rankings and pit problems.
- **Plain values:** "Qual 12", team "254", Yes/No, "Didn't run", "Brownout", lists like "Scorer, Defense", rankings like
  "1. 254   2. 1678", and times in the team's timezone. Numbers (estimates, ratings, fouls) stay numbers for averages.
- **Left out:** ids, account codes, form versions, Slack fields, raw min/max duplicates, auto paths, columns nobody
  filled in for the event, and robot-condition defaults on Data and Performance reports, which didn't ask them.
- **Excel tabs:**
  - **Teams:** one row per team with pit robot type and drivetrain, reports by kind, average balls, auto, shot
    accuracy, BPS, driver skill and defense, average power rank place, matches with a problem, and no-shows. Sorted
    by average balls; the top quarter's team numbers are green and the bottom quarter's red.
  - **Data scouting**, **Performance scouting**, **Robot scouting**, **Pit scouting**, **Notes & pit problems:** each
    kind with only "Who, when" and its own questions. Tabs with no records are left out.
  - **All records:** everything together, for filtering across kinds.
  - **Guide:** the event, export time, what each tab holds, and the color key.
- **Excel looks:**
  - colored tabs, a heading color per column group, and a row tint per record kind
  - 1–5 ratings colored red (1) to green (5)
  - estimates and averages shown to one decimal
  - thin row dividers, and bold Record/Match/Team
  - the headings and the first three columns are frozen, with filters on
  - columns are wide enough that no heading breaks inside a word
  - red text marks problems (dead or stopped, crash, break, beaching, jam, card, no-show, urgent issue)

**Google Sheet** sync writes the All records table to the shared sheet (cleared first, so nothing old lingers),
then formats it the same way: frozen headings and Record/Match/Team, bold headings colored by form, a filter and
column widths.

Logic: `src/lib/server/scouting/readableExport.js` (table, CSV, Excel), `src/lib/server/xlsx.js` (the workbook
writer, no dependency) and `fetchEventExportRecords` in `src/lib/server/scouting/admin/eventData.js`.

## Storage and data cleanup

The **Storage** card (`src/lib/components/scouting/DataStoragePanel.svelte`) shows how full the database and file storage are,
against limits of 80% of the Supabase free plan: `RETENTION_DB_LIMIT_MB` (default 400) and `RETENTION_STORAGE_LIMIT_MB`
(default 800, all buckets together). It also lists the biggest tables, marked **cleanable when old** or **kept**.

Nothing is deleted on a schedule.
- **Under both limits:** the card says nothing needs doing, and how much old data would qualify if a limit were crossed.
- **Over a limit:** it lists **Would be deleted** and an **Approve cleanup** button, behind the in-app confirm dialog.
- **Daily check:** `/api/scouting-admin/retention-cron` DMs the admins once per plan, when Slack is set up. It never
  deletes.

**What can be cleaned** (`src/lib/server/retention/policy.js`). The policy names rows and files, not whole tables:

| Item | Which rows or files | Kept for |
| --- | --- | --- |
| Scouting event logs (`scout_data_events`) | One past-season event's rows | 180 days after the event's newest row |
| Pit photos | The files in a past-season event's folder | 180 days |
| Sent notification records (`user_notification_logs`) | Scouting assignments, match reminders and cleanup alerts | 90 days |

**Never cleaned:**
- Match and pit scouting reports, picklists, rankings and assignments.
- Anything from the current season (the season of the active event, or this year when none is set) or from the active event.
- `activity_log`, the audit trail of changes.
- The `branding` bucket (the team logo).

**How a cleanup runs** (`src/lib/server/retention/plan.js`, `apply.js`):
- **Plan:** the plan is computed the same way for the card, the daily check and the approve action. Its `plan_id` names the
  exact items, so approving a plan that has changed since you loaded it is refused.
- **Deletes:** run in batches (1,000 rows, 100 files), each query repeating the plan's scope.
- **Log:** one summary row goes to `activity_log` (`table_name = 'data_cleanup'`), with the counts and any failures.

The sizes come from three read-only, service-role-only SQL functions in the schema (`retention_sizes`,
`retention_event_inventory`, `retention_storage_objects`).


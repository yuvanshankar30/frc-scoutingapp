# Data Viewer

**Analyze → Data Viewer** (`/dataviewer`) shows every answer from match and pit scouting at the event, field by
field, both as a chart and as text. Any approved, signed-in member can open it: it reads the same scouting report as
Team View and Strategy Board, so it adds no new database access.

## What it shows

Five tabs: **Match scouting** (Data, Performance and Robot reports), **Pit scouting**, **Rankings**, **Scout entries** and
**Agent** (the analysis agent, switched off for now). The data
loads once (`src/routes/dataviewer/+layout.svelte`); every page under `/dataviewer` reuses it and slides in when you
open it.

### Overview (`/dataviewer`)

One section of the form at a time: Pre-match, Auto, Teleop, Shuttling, Performance, Robot and Post-match for match
scouting; Robot, Scoring and auto, Ratings, Build and electrical, Software, Notes and contacts for pit scouting.
Desktop shows the sections as numbered steps (with how many of each section's fields have answers) and previous/next
buttons under the cards; phones get arrows around a section picker and dots for where you are. Moving to a later
section slides the cards in from the right, an earlier one from the left. Searching for a field shows matches from
every section at once.

Every field is a card of the same size with its name, the kind of report that asks it, a one-line headline and a small
chart of its top three:

| Answer type | Headline | Chart |
| --- | --- | --- |
| Number (balls scored, auto points, fouls, …) | average and lowest–highest | one bar per team (its average), with a line for its lowest to highest answer |
| Rating (1–5, 1–10) | average of the scale | one bar per team on the rating's scale |
| Yes / no | share of "Yes" | one bar per team: its share of "Yes" |
| Choice, list (roles, starting position, climb, …) | most common answer | how often each answer was given |
| Text (notes, details) | how many written answers | the latest answer, quoted |

### A field's page (`/dataviewer/field/<form>/<field>`)

Clicking a card opens the field on its own page: reports, teams and the average/range (or share of "Yes", or most
common answer), every team's bar, the distribution of answers, then a **Teams** table (reports, average/min/max,
share of "Yes" or most common answers per team) and a **Reports** table (match, team, report kind, scout and answer,
newest first, 40 at a time). A match report's match links to its scout entry. With one to five teams picked, number
and rating fields also get a match-by-match line per team. Previous/next step through the form's fields; Back returns
to the field's section. Phones show the tables as cards.

Number and rating fields in match scouting also get **Who is improving**: each team's mean over its last 3 scouted
matches minus its first 3 (several reports on one match are averaged first; a team needs 6 matches), best improver
first, each team linking to Team View (`fieldTrend` in `dataViewer.js`).

### Rankings (`/dataviewer/rankings`)

Every scouted team ranked on one standard match metric (`MATCH_METRICS` in `teamCharts.js`, shared with Team View),
the `/data` address redirects here with its `?event_key=` and `?metric=`.

- **Top teams:** each team's average on the metric, with **n** (distinct scouted matches with a value); n < 3 is
  faded. Fouls rank fewest first. Event teams with no reports are listed as "Not scouted", and teams with reports but
  none for this metric separately, never drawn at 0.
- **Who is improving:** last 3 minus first 3 scouted matches (needs 6), and per-match lines (each team's own match
  number on the x axis) for the top 3 improvers plus up to five teams you add.
- Links to Team View ("Back to Rankings" keeps the metric) and, for admins, Scouting Admin > Overview. The metric is in the URL (`?metric=`). The match type and qualification range
  filters apply; the team, report-kind and search filters don't (rankings cover every team).

Code: `src/routes/dataviewer/rankings/+page.svelte`, `src/lib/scouting/dataPage.js`,
`src/lib/components/charts/RankedBars.svelte`, `teamMetricStats` / `teamTrend` / `ownMatchSeries` in `teamCharts.js`.

### Scout entries (`/dataviewer/entries`, match scouting only)

Every match scouting report under the filters, latest match first: match, team, report kind, scout and when it was
submitted. The search box finds a team, match, kind or scout. Opening one (`/dataviewer/entries/<id>`) shows the team,
match, kind, alliance, scout and time, then every question that kind of report asked, section by section, with the
answer or "—" when it was left blank. Each question links to its field page; previous/next follow the list.

Blanks are "not scouted", never 0: averages and shares only count reports that answered. A question only counts on the
kind of report that asks it, so a Data report's default "no crash" is not read as a Robot answer; reports from before
the Data / Performance / Robot split asked everything on one form and count for all of them.

### Following the published form

Built-in fields follow the form published in **Scouting Admin → Edit** (`followForm` in `dataViewerFields.js`, with
each field's block in `BLOCK_FIELDS`): when an admin rewords a block that has one field, the card uses that wording;
when an admin hides a block, its fields drop out of the overview unless older reports still have answers to them.

### Added questions

Questions added in **Scouting Admin → Edit** show up by themselves, at the end of their section and tagged
**Added question**. The page reads the live form and every form version the reports were answered against
(`/api/scouting-forms?form=…&version=N`), so a question keeps its newest wording and a removed one still shows its
old answers. Pit questions go under Notes and contacts.

## Analysis agent (built, switched off)

A Gemini agent that answers questions about the event, with its own tab (`/dataviewer/agent`). **It is off:**
`ANALYSIS_AGENT_ENABLED` in `src/lib/scouting/analysisAgent.js` is `false`, so the Agent tab shows but its page only
says it isn't on yet (the question box is disabled), and `POST /api/dataviewer-agent` answers 503 before reading the request, whatever keys the server
has. No API key is set. To turn it on: set the flag to `true` and give the server `DATA_VIEWER_AGENT_GEMINI_API_KEY`
(its own key, so it never spends the assistant's credit).

**The page** is a chat laid out like AI analytics (`/assistant`): recent chats on the left (kept in this browser per
person under `scouting-ai-chats:agent:<user>`, so signing out clears them), suggestions on the welcome screen, answers
with the sources they used and a copy button, and the question box docked at the bottom. Phones get their own screen: a
status line, suggestion chips, and the question box docked above the bottom bar. The Data Viewer's tabs are one even
row of five on phones.

**What it reads (read-only):**

| Source | Tools | Needs |
| --- | --- | --- |
| Our scouting | `list_fields`, `field_summary`, `team_fields`, `field_trend`, `metric_rankings`, `scout_entries` (the Data Viewer's own functions, added questions included), plus the scouting assistant's read-only tools (notes, problems, picklist, matchups, rankings, …) | the caller's own database client, so row-level security applies |
| The Blue Alliance | `tba_get` | `TBA_API_KEY` |
| FIRST FRC Events API | `first_get` | the `frc-data` Edge Function (its secrets `FRC_API_USERNAME`, `FRC_API_TOKEN`) |
| Match13 | `match13_get` (xP ratings, `/events/<key>/sim` forecasts) | the `frc-data` Edge Function (its secret `MATCH13_API_KEY`) |
| Statbotics | `statbotics_get` (EPA) | nothing |

**FIRST and Match13 keys live only in the `frc-data` Supabase Edge Function** (`supabase/functions/frc-data`), never in
this app's environment. The agent's server calls it with the project's service-role key (`POST /functions/v1/frc-data`
with `{ source, path }`); the function refuses anything else (a browser, the anon key, a signed-in user's token), so
nobody else can spend the FIRST or Match13 quota. It adds the credential, applies the same path allowlists (a test
checks they match the agent's), a 10 s timeout, a 2 MB cap, a short cache and its own per-minute ceiling, and
`{ action: 'status' }` says which secrets are set without showing them. Deploy it to your project and set its secrets:

```sh
supabase functions deploy frc-data --project-ref <project>
supabase secrets set FRC_API_USERNAME=… FRC_API_TOKEN=… MATCH13_API_KEY=… --project-ref <project>
```

TBA (`TBA_API_KEY`) and Statbotics (no key) are called directly. The model only names a source and a path: the server
builds the URL from the source's fixed base, checks the path against that source's allowlist (plain segments only, no
`..`, `//`, `@` or other hosts), times out after 10 s, refuses answers over 2 MB, caches answers briefly and keeps each
source under a per-minute ceiling (Match13's 60-a-minute limit is for the whole account, so the agent takes at most 20).
A failed or unconfigured source comes back to the model as an error it reports, never a crash.

**How it answers:** up to 8 model rounds and 6 tool calls a round; each tool result is cut to 14,000 characters with a
note; the answer lists the sources it used. The system prompt tells it to use only numbers from tools, treat blanks as
not scouted, say where each number came from and give both when our scouting and an official source disagree. Only
approved accounts may ask (8 questions a minute each).

Code: `src/lib/server/dataViewerAgent/` (`agent.js` config, snapshot and loop; `tools.js`; `sources.js`),
`src/routes/api/dataviewer-agent/+server.js`, `src/routes/dataviewer/agent/+page.svelte`; tests in `agent.test.js` and
the route's `server.test.js`.

## Filters

- **Event:** the current scouting event, or any other event in the picker.
- **Find a field:** narrows the cards by field or section name.
- **Teams:** add any number of teams; each shows as a chip you can remove.
- **Matches** (match tab): qualifications, playoffs or practice, and a qualification range (from–to).
- **Report** (match tab): Data, Performance or Robot. Fields the kind doesn't ask are hidden too.
- **Hide unanswered** (overview).

Filters stay set while you move between the overview, field pages and entries. The team filter applies to pit
scouting too; the match and report filters don't. On phones the filters are in a sheet
opened by the **Filters** button docked above the bottom bar (it shows how many are on).

## CSV

**CSV** downloads what is on screen: one row per report (match, team, report kind and scout for match scouting; team
and scout for pit scouting) and one column per shown field, with values as on the cards. Cells starting with `=`, `+`,
`-` or `@` are quoted so a spreadsheet never runs them. The full export with every record type stays in
[Scouting Admin → Data](../scouting-admin/data.md).

## Code

- `src/routes/dataviewer/+layout.svelte`: header, tabs, filters (a sheet on phones), CSV and the page transition.
- `src/routes/dataviewer/+page.svelte`: the overview (sections and field cards).
- `src/routes/dataviewer/field/[form]/[id]/+page.svelte`: a field's page.
- `src/routes/dataviewer/entries/+page.svelte` and `entries/[id]/+page.svelte`: the scout entries list and one entry.
- `src/lib/components/dataViewer/state.js`: the shared data and filters (loaded once in the layout).
- `src/lib/components/dataViewer/Filters.svelte`: the filter controls, shared by the desktop bar and the phone sheet.
- `src/routes/dataviewer/rankings/+page.svelte` and `src/routes/dataviewer/agent/+page.svelte`: Rankings and the agent.
- `src/routes/data/+page.js`: redirects the old Analyze > Data address to Rankings.
- `src/lib/scouting/dataViewerFields.js`: the field catalog: every built-in match and pit field (type, section, kind,
  how to read it) and designer questions as fields.
- `src/lib/scouting/dataViewer.js`: filters, per-field summaries, chart rows, headlines, entries and the CSV.
- `src/lib/components/dataViewer/FieldCard.svelte`, `FieldDetails.svelte`, and `src/lib/components/charts/TeamBars.svelte`.
- Data: `GET /api/scouting-report?event_key=…` (match and pit reports with scout names; approved members only) and
  `GET /api/scouting-forms?form=…[&version=N]`; team names from `/api/tba/event-teams`.

## History

Newest first. Every version is in [VERSION.md](../VERSION.md).

- [V1.9.0](../VERSION.md) (2026-11-14): New page: every match and pit scouting field (following the published form) as same-size cards with a page per field, Rankings and who is improving, Scout entries with a page per report, filters and a CSV of the view; an Agent tab with a Gemini analysis agent (our scouting, TBA, FIRST FRC Events, Match13, Statbotics), built but switched off.

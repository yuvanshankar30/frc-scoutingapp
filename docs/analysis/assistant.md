# AI analytics (scouting assistant)

Off by default: turn it on in [Team settings](../scouting-admin/team-settings.md) (Pages in the menu) once the server has an AI key. The page works at `/assistant` either way.

Analyze > **AI analytics** answers plain-language questions about the active event ("who scores the most", "compare 254 and 1678", "which robots break down") from our own scouting data.

## How it works

1. The browser posts the conversation and the event key to `/api/scouting-assistant`.
2. The server loads the event's scouting data with the **caller's own database client**, so row-level security applies exactly as on every other page (`eventData.js`).
3. A tool-calling loop (`agent.js`) lets the model call **read-only tools** (`tools.js`): `rank_teams`, `team_report`, `compare_teams`, `search_notes`, `open_problems`, `team_match_reports`, `event_overview`, `find_team` and `alliance_matchup`. Team numbers come from the same scoring the Power Rankings page uses.
   - Every tool accepts a team **name** as well as a number ("Citrus", "Cheesy Poofs"). `teamNames.js` resolves it against the event's teams on The Blue Alliance, and only if that finds nothing against every FRC team (fetched once, kept for 12 hours). A name that could mean several teams comes back as a question rather than a guess.
   - `alliance_matchup` answers "how do we play against X" in one call: both alliances' profiles, expected totals, a win-chance range (capped at 3 to 97 percent, with a confidence label), role hints and a watch list. The arithmetic is in `matchup.js` and is an estimate from scouted ball counts and official OPR; it ignores climbing, defence and how robots interact.
4. The model answers from tool results only. Up to 10 model rounds per question, the calls within a round run together, and the last round has no tools so the model must write its answer. Results from earlier rounds are trimmed, and if the final answer comes back empty it is asked once more before the assistant says what it looked at.

The model never sees the database, only capped tool output, and it has no write tools.

## Safety

- Scout notes are text typed by people, so they are returned as data and the system prompt tells the model to ignore instructions found in them.
- Only `user` and `assistant` text from the client is accepted (no forged `system` or `tool` messages), capped at 12 messages of 2000 characters.
- 12 questions per user per minute (in memory, per instance); sign-in required.
- Answers can be wrong. The page says so and the tools report how many matches were scouted behind each number.

## Configuration

Set `GEMINI_API_KEY` or `OPENAI_API_KEY` on the server (see [.env.example](../../.env.example)). Gemini is used when its key is set. Override with `ASSISTANT_PROVIDER`, `ASSISTANT_MODEL`, `ASSISTANT_BASE_URL`; both providers use the OpenAI-compatible chat-completions API. Without a key the endpoint returns 503 and the page says it is not configured.

## Not covered yet

EPA is not exposed as a tool; adding one is a new function in `tools.js` plus a test.

## Everything it can do

**Read** (always with the signed-in person's own database access, scoped to the open event): rankings, team reports, who scouted what (scout names only), match overviews, post-match rankings and head-to-head votes, the picklist, official Blue Alliance results, free-text search across every kind of note, and `query_table` for any readable scouting table. Account, role, permission, roster-key, assignment, deadline and settings tables are not readable and account columns are stripped from every row.

**Files.** `export_csv` (one kind of data, narrowed to teams, matches and columns), `export_query_csv` (any readable table) and `export_table_csv` (a table the assistant assembled from tool results). The file is built on the server, returned with the answer and shown as a file card with a Download button; the model never sees the file. Cells go through the same formula-safe escaping as the Scouting Admin export. Files up to 100 KB are kept with a saved chat.

**Changes.** The model has no write access at all. It can only *propose* an action (add a scout note; add, add several, remove, move, reorder or annotate picklist teams). A proposal appears as a card with the exact change and Confirm / Cancel; on Confirm the browser sends it with the person's own sign-in to the existing endpoint (`/api/scouting-picklist`, `/notescout`), so the same validation and permission checks apply. The browser refuses anything not on that two-path allowlist (`src/lib/assistant/allowedPaths.js`). Pit-problem reports are deliberately not offered: they send Slack notifications. Text inside scout notes is untrusted, which is why nothing happens without a click.

## Chat history

Each conversation is saved after every message. **Load chats** opens a searchable, scrollable list (arrow keys and Enter work; Escape closes it) and **New chat** starts a fresh one. Chats are kept in the browser's local storage under the signed-in user's id (`src/lib/assistant/chatStore.js`): up to 60 chats of 60 messages, newest first, only tool names kept for each answer. They are not sent to the server or shared between people, and clearing site data removes them, so this is a convenience, not a record. Moving them to the database later means replacing the store behind the same functions and adding a table with row-level security by user.


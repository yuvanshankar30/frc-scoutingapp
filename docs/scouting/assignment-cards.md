# Assignment cards

Home and My Reports share `MyAssignments.svelte`. Each card reads like `Performance scout · Qual 12 · 254 · RED`, with
an alliance-coloured edge, and opens Match Scouting with the tab, match, robot and alliance filled in. The kind
(Data / Performance / Robot) comes from the scout's role (`defaultReportKind` in `src/lib/scouting/reportKinds.js`). A
played match that still has no report is flagged. Assignments and the schedule load through `fetchWithCache`, so the
list still shows on bad venue Wi-Fi. API: `/api/scout-assignments`.

On phones, My Reports is one screen with a To do / Match / Pit switch and a docked **Start next** button.


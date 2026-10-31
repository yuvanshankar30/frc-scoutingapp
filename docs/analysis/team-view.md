# Team View

`/teamview` opens on a card for every team TBA lists at the event: robot photo, number, name, rank, record, OPR,
average balls and auto points, and coverage ("Scouted 3 of 4 played · pit done"). Search by number or name; sort by
rank, number, OPR, balls, auto, or least scouted. Old `?team=` links still open a team directly.

Each team page has charts in five tabs built from the Data, Performance and Robot reports: **Scoring**, **Ratings**,
**Robot**, **Tendencies** and **vs Event** (percentile among the event's teams). Matches nobody scouted show as gaps,
not zeros. Maths: `src/lib/scouting/teamCharts.js`; charts: `src/lib/components/charts/` (plain SVG on the `--chart-*`
tokens); panel: `TeamChartsPanel.svelte`; grid: `TeamGrid.svelte`.


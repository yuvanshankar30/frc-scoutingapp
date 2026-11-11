# Scouting Admin: Assignments

Who scouts which teams and matches, with bulk assign, conflict warnings and filters. Each scout shows a role pill and
the match table marks each cell **D / P / R** (the kind of report the scout's role files). API:
`/api/scout-assignments`, `/api/pit-scout-assignments`, `/api/prescout-assignments`.


## Shifts

Assignments > **Shifts** plans match scouting by field spot instead of by robot. A shift is one scout on one spot
(Red 1 to Blue 3) from one qualification match to another: during it they scout whichever robot stands in that spot in
every match, then take a break while the next scout on that spot takes over. Each spot is a lane with a bar showing
how much of the schedule it covers.

- **Auto-plan** cuts the schedule into shifts of a chosen length and deals the picked scouts to spots in order (1st to
  Red 1, 2nd to Red 2 … 7th to Red 1 again), so each scout keeps one spot and spots with two scouts take turns. It says
  which spots have nobody, or nobody to hand over to.
- The board checks for overlapping shifts on a spot, a scout in two places at once, and ranges outside the schedule;
  nothing saves until those are fixed.
- **Save** keeps the plan (`scout_shifts`, `/api/scout-shifts`). **Save and publish** also writes the ordinary
  per-match assignments, so scouts see them on Home like any other assignment.

Saving needs the "Manage match assignments" permission. Logic: `src/lib/scouting/shiftPlan.js`.

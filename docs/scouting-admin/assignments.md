# Scouting Admin: Assignments

Who scouts which teams and matches, with bulk assign, conflict warnings and filters. Each scout shows a role pill and
the match table marks each cell **D / P / R** (the kind of report the scout's role files). API:
`/api/scout-assignments`, `/api/pit-scout-assignments`, `/api/prescout-assignments`.


## Shifts

Assignments > **Shifts** plans match scouting by field spot instead of by robot. A **shift** is a run of qualification
matches (Q1–Q8, say). Inside it, each **seat** is one scout on one spot (Red 1 to Blue 3): they scout whichever robot
stands in that spot in every match of the shift, then take a break while the next shift's scouts take over.

- **Shift cards** (Shift-based assignments) show each shift's six spots and the scouts on them. A spot can have several
  scouts (double coverage), and a seat with nobody yet is an **open seat**. **Quick assign** picks one scout and puts
  them on any spots at once, or a whole alliance with All red / All blue.
- **General shifts** shows the same shifts as rosters, one tab per shift. Add people (one at a time or everyone shown)
  and they are seated in order: 1st on Red 1 through 6th on Blue 3, and a 7th sits on Red 1 again as a second scout.
  Reorder, swap or remove people; the shift cards update as you go. **New shift** adds the next run of matches.
- **Each scout's matches** works out, from the Blue Alliance schedule, exactly which robot each scout watches in every
  match of their shifts.
- **Auto-plan** cuts the schedule into shifts of the chosen length and deals the picked scouts to spots in order, so
  each scout keeps one spot and spots with two scouts take turns.
- The plan only refuses ranges that run backwards or past the schedule, and the same scout twice on the same spot.
- **Save** keeps the plan (`scout_shifts`, one row per seat, `/api/scout-shifts`). **Save and publish** also writes the
  ordinary per-match assignments for every filled seat, so each scout sees their exact robots under My assignments.

Saving needs the "Manage match assignments" permission. Logic: `src/lib/scouting/shiftPlan.js`.

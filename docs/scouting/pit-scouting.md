# Pit Scouting

Scout > **Pit Scouting** (`/pitscout`) is a profile of each robot in the pits: drivebase, shooter, hopper and photos,
plus a list of problems for the pit crew. Reports are rows in `pit_scout_entries`; problems are `pit_problem_reports`
(they can notify Slack). The form's choices, limits and "complete" rules are in `src/lib/scouting/pitForm.js`, shared with the API and Scouting Admin; the problems queue is `src/lib/components/scouting/PitProblemsView.svelte`. Photos are shrunk in the browser before upload to save storage egress.

The page shows status tiles and a team tile grid. On phones the topic row stays pinned, Submit is docked and problems
are added in a sheet (see [phone layout](../app/phone-layout.md)).


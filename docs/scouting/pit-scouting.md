# Pit Scouting

Scout > **Pit Scouting** (`/pitscout`) is a profile of each robot in the pits: drivebase, shooter, autos, strengths and weaknesses, and photos,
plus a list of problems for the pit crew. Reports are rows in `pit_scout_entries`; problems are `pit_problem_reports`
(they can notify Slack). The form's choices, limits and "complete" rules are in `src/lib/scouting/pitForm.js`, shared with the API and Scouting Admin; the problems queue is `src/lib/components/scouting/PitProblemsView.svelte`. Photos are shrunk in the browser before upload to save storage egress. Each photo upload gives up after 30 s, so a stalled connection never holds the save: the notes still save (or queue offline) and the page says the photo did not upload.

## The form

The team number and name come from the team picked in the grid. Each team has two tabs, **Main** and **Photos**;
each shows how many of its answers are filled in.

**Main** has every question on one page, in this order:

1. **Drivebase**: one described answer, e.g. "Swerve, MK5n modules" (saved in `drivebase_type`).
2. **Drivetrain dimensions**: length, width and height in inches.
3. **Robot weight**: free response, without bumpers and battery (`robot_weight`, e.g. "112 lb").
4. **Trench, bump or both?** (Trench, Bump, Both; there is no "Neither").
5. **Shooter and indexer**: shooter type, indexer type, hopper capacity. Both dropdowns start with a "No Shooter" /
   "No Indexer" choice for robots without one.
6. **Estimated BPS**: slider plus a number box.
7. **Autos**: each one named, described and drawn on the field.
8. **Points scored in auto**.
9. **Preferred role in the game** (shooter, shuttler, defense, collector, climber, flexible; pick every one that applies).
10. **Strengths**.
11. **Weaknesses and what is likely to break**: one answer. It saves to `weaknesses` and also fills the old
    `likely_breaking_component` column (first 240 characters), which Strategy, the export and the assistant read.
    Reopening an older report folds its "likely to break" answer into the box once.
12. **Main breaker and CAN**: breaker brand, breaker protected from bumps, number of CANivores and number of CAN buses
    (both free response; `canivore_count` replaces the old yes/no "Uses CANivore?", and older numeric CAN bus counts read
    back as text).
13. **Controls and software**: coprocessor, WPILib, auto tools, vision, programming language, anything else.
14. **Strat person's phone number** (`strat_phone`), used by the Strategy board's
    [Meetings tab](../analysis/strategy-board.md#meetings-tab) to text partners.
15. **Extra notes**.

**Photos**: up to three photos of the robot.

Submit saves both tabs at once.

If a save fails (a missing answer, an expired sign-in, an error from the server), the reason is shown right above the
Submit button.

### What was removed in V4.46.0

The old **Extra** tab is gone. Its questions were folded into Main (Shooter & Scoring, Controls, the drivetrain
dimensions, the drivebase) or dropped: archetype, the 1-10 ability ratings and weighted score, the separate "most
likely to break" question, Setup (pit contact name and phone, the drivebase dropdown, climb options), the rest of
Mechanisms (net, intake style, roller motors, motor controllers and types), Electrical, Ratings, and the rest of
Structure (swerve module, fits under trench and drives over mound, which trench/bump already answers, bumper size and
foam, encoders, printed roller hubs).

Nothing already saved is deleted. Resaving a report sends its old archetype, climbs and pit contact back unchanged,
and the old technical answers stay in `technical_details`, so Team View, Power Rankings and the picklist still show
what older reports recorded (including their 1-10 ratings, `PIT_ABILITIES` in `src/lib/scouting/pitForm.js`).
A report that had "Neither" for trench/bump loses that answer when it is resaved.

Admins can still reword, hide and reorder the Main questions in Scouting Admin > Edit. Questions an admin added to the
old Extra tab now appear at the end of Main (`movedSections` in `src/lib/scouting/forms/formSchema.js`), with their
answers. A form whose Main order was saved before V4.46.0 shows the new questions after the ones it already ordered.

### Phone

On a phone, opening a team switches to its own entry screen: the list header and Team profiles / Problems tabs step
aside, and a pinned bar holds Back, the team number and a two-part Main / Photos switch with each tab's count. Each
question sits in its own panel, sub-answers stack in one column, fields are 16px (so iOS doesn't zoom), choice
buttons are at least 44px and laid out in even columns, and Submit is docked above the bottom bar. Photos get a
full-width Take Photo button and a two-column grid. The team list keeps its status tiles and tile grid, and problems
are added in a sheet (see [phone layout](../app/phone-layout.md)).


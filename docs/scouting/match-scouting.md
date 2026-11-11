# Match Scouting

Scout > **Match Scouting** (`/matchscout`) is a report on one robot in one match. API: `/api/matchscout`; reports are
rows in `match_scout_entries`.

## Three kinds of report

A tab bar splits scouting into three reports, each with its own stages:

| Tab | Stages | Who |
| --- | --- | --- |
| **Data** | Pre-match → Auto → Teleop → Shuttling → Post-match | Data Scout Members |
| **Performance** | Pre-match → Performance → Post-match | Performance Scout Members |
| **Robot** | Pre-match → Robot → Post-match | Robot Scout Members |

A scout opens Match Scouting on their role's tab (roles are set in [Scouting Admin > People](../scouting-admin/people-and-roles.md)).
`report_kind` (data, performance or robot) is part of the unique key, so one scout can file one report of each kind per
robot. Each kind may only fill its own fields (`KIND_ONLY_FIELDS` in `src/lib/scouting/reportKinds.js`, also enforced by
database checks; see [database](../architecture/database.md)). Play statistics come from data reports only.

## Sections

Pre-match, then *Data scouting* (Auto, Teleop roles and balls scored, Shuttling), then *Performance* and *Robot*, then
Post-match notes. Each answer is stored in its own column on `match_scout_entries`.

- **Data, defense.** Picking **Defense** as a teleop role opens **Defense details** (required): the robots it defended
  against (the other alliance from the schedule, or typed in), whether its hub was **active** or **inactive**, the
  shifts (1–4, Endgame), and a **1–10 effectiveness**. Real-scout observations then become required and prompt the
  scout to describe the defense. Saved as `defense` (`{ targets, periods, shifts, effectiveness }`). Picking
  **Shuttler** sets "Did the robot shuttle fuel?" to Yes.
- **Performance** (every answer required): shot accuracy (1–5), **balls per second** from a 0–40 slider (`bps`; its
  1–5 band also fills `ratings.BPS` for older analytics), intake speed, driver skill, the power ranking and notes.
  Driver awareness, defense, reliability, offense and defense ratings are no longer asked; older reports keep them.
- **Robot:** robot status (active, dead, stopped) **for every shift** and the endgame (`robot_status_shifts`; the worst
  one is also saved as `teleop_robot_status`), significant crash, auto collision, intake jammed, cards, minor and
  major fouls (any foul asks for its **nature** from a dropdown, `foul_nature`, with `foul_details` required for
  "Other"), the mechanical-break question (a break requires **what broke**), how it affected the robot and how the
  team handled it, beached, and the pit crew handoff.

On phones each of these has its own layout: the defense card stacks its labels over thumb-size controls with the
1–10 effectiveness in two rows of five, BPS shows a large readout with − / + buttons beside the slider, and robot
status is a compact shift-by-shift matrix.

These rules apply to reports sent as `section_fields: 4`; reports from an older page or queued offline before the
change still save under the old rules.

Each scout's ranking is a `power_ranking` object of team key to rank, leaving out robots they did not watch; Power
Rankings averages it per match over the scouts who ranked each robot, then per robot over its matches
(`src/lib/scouting/powerRankingAverages.js`, `/api/matchscout?resource=power-rankings`).
Offseason B teams keep TBA's key with its letter (`frc4414B`) in a power ranking, in a Match Rankings order and in
the robots a defender defended (`normalizeRankedTeamKey` in `src/lib/scouting/matchScouting.js`; the typed Team # box
keeps the letter too). Before V4.48.2 one B team made the server drop the whole ranking, so the report could not be
submitted ("Rank the robots you watched with distinct places from 1 to 6"). Before V4.49.1 a B team was dropped from
the defended robots, so defending only a B team could not be submitted ("Select the robots it defended against"). A B team's own report still can't be saved: the scouting tables only accept plain team numbers.

Admins can add their own questions to any section; see [editable forms](../scouting-admin/edit-forms.md).

## Did the robot show up?

Pre-match on every tab asks **Did the robot show up to the field?** with **Yes** already selected: a robot nobody
marks missing showed up, and the report saves `robot_present = true`. Tapping **No** makes every other question
optional and offers **Submit report** right there; tapping No again goes back to Yes. A no-show saves
`robot_present = false`, shows a "Did not show up" badge, and counts as 0 points and an incident in EPA.

## Match numbers

The match box takes "12", "Q12", "Quals 12", "sf2m1" or "f1m2" and stores the real match key (`2026cc_qm12`);
anything it can't read is refused with a hint, before and at submit (`canonicalMatchKey()` in
`src/lib/matches/matchKeys.js`). The typed text is kept in `match_label`.

## Opening from an assignment

An assignment card on Home or My Reports opens `/matchscout?tab=<kind>&match=…&team=…&alliance=…&event_key=…`, which
fills in the tab, match, robot and alliance. See [Home and My Reports](assignment-cards.md).


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

Pre-match, then *Data scouting* (Auto, Teleop roles and balls scored, Shuttling), then *Performance* (shot accuracy and
BPS ratings, the optional driver awareness, defense and reliability ratings, intake speed, driver skill, offense and
defense ratings, notes, and a power ranking of the match's robots) and *Robot* (robot status, significant crash, auto
collision, intake jammed, cards, minor and major fouls, the mechanical-break question with what broke, how it affected
the robot and how the team handled it, beached, and the pit crew handoff), then Post-match notes. Everything new is
optional and stored in its own column on `match_scout_entries`.

Each scout's ranking is a `power_ranking` object of team key to rank, leaving out robots they did not watch; Power
Rankings averages it per match over the scouts who ranked each robot, then per robot over its matches
(`src/lib/scouting/powerRankingAverages.js`, `/api/matchscout?resource=power-rankings`).

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


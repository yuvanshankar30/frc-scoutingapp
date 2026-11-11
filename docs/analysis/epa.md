# EPA

`/epa` computes Expected Points Added from raw match data.

## How the rating works (V4.11.0, #171)

Each team's EPA is its expected share of its alliance's score, in points. It is fitted over every played match at
once, ridge regression on official TBA alliance scores, and each team is pulled toward a **scouting prior**:

- **Data reports:** balls scored plus auto points, averaged across scouts per robot per match, shrunk toward the
  event average. Missing is "not scouted", never 0.
- **Performance reports:**
  - shot accuracy × BPS fills in robot-matches no Data scout covered, and gives a small per-team adjustment
  - the offense, defense, driver and intake ratings
  - power rankings: each scout's best-to-worst order of the robots they watched
- **Scout match rankings:** the scouting group's best-to-worst order of all six robots each match
  (`scouting_match_rankings`).
- **Robot reports:** breaks, big crashes, beaching, a dead or stopped robot, and no-shows lower the estimate. A robot
  that didn't show up counts as 0 points.
- **Defense:** a robot that plays defense (Data report role), scaled by its Performance defense rating, takes points
  off the alliance it plays against. `predictAllianceScore` applies this everywhere the model is used.

The scouting estimate is converted to points by a line fitted on the alliances played so far (scouts undercount by a
roughly constant amount). Early in an event the prior carries the rating; as matches pile up the scores take over.
Ratings are split into auto, teleop and endgame from TBA's score breakdown.

**Where it's used:** /epa, Strategy (projected scores and win chances),
and model votes. All of them read the same scouting the server can see.

**Back-test** (walk-forward: every match predicted only from earlier matches and earlier scouting):

| Event | Scores only | With scouting |
| --- | --- | --- |
| 2026cacg | Brier 0.140, winner 77%, score error 72 | Brier 0.126, winner 85%, score error 62 |
| 2026cc | Brier 0.191, winner 71%, score error 123 | Brier 0.169, winner 75%, score error 108 |

The old model (one match at a time, fixed learning rate) scored 0.199 / 0.217 Brier with its defaults.

- **Defense and a stronger scouting prior** each improved both events.
- **Rankings and power rankings** are used at a small weight. They changed the score by about ±0.002, inside the
  0.027 standard error, so they don't add measurable accuracy yet.

The **Accuracy** tab compares scores-only with scouting for the event shown, and **Predict** says who won once a
match has been played. `/epa?event_key=2026cc` opens another event directly.


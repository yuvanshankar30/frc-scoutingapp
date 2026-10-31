# Strategy Board

`/strategy` is a Team View-style brief for every team at the event, built for match and pick decisions.

- **Overview:** event counts (teams, match reports, pit profiles, open issues) and **your team's next matches**: partners
  and opponents (tap one to open their brief) and our EPA win chance.
- **Teams tab:** a searchable team list sorted by EPA, event rank, scouted fuel, auto points, shot accuracy, BPS,
  reliability, reports or team number. The selected team's brief sits beside it on desktop and opens in a bottom
  sheet on phones. Desktop opens on your team (or the top team) so the brief is never empty. **Send order to Picklist**
  sends the list in the order shown.
- **The brief** (`StrategyTeamBrief.svelte`):
  - event rank, record and EPA rank
  - key numbers: EPA with auto/teleop/endgame, scouted fuel, auto points, shot accuracy and BPS (with their bands),
    driver skill, reliability (matches without a break, crash or no-show) and coverage by report kind
  - **match by match**: scouted points per match, incidents and no-shows marked, with the official result
  - next matches with partners, opponents and win chance
  - how they play (teleop roles) and saved autos
  - pit capability, open pit problems and scout notes
  - scouting reports by kind (Data, Performance, Robot), latest three with "Show all"
- **Scout accuracy tab:** scouting checked against TBA per alliance and per scout (see below).

Numbers come from the EPA model (official scores anchored to match scouting, [epa](epa.md)), match and pit
scouting, and TBA rankings. The old Matches tab is gone: our upcoming matches are in the overview, and any team's
next matches are in its brief.

### Scout accuracy

For each played match, the three robots' scouted numbers are added up per alliance (scouts covering the same robot
are averaged) and compared with TBA's breakdown: fuel scored, auto points, and the fouls the alliance committed. Only
alliances with all three robots scouted count toward the totals; partial ones are listed with the missing robot
named. It also checks whether the alliance with more scouted fuel actually won, and, per scout, how much of TBA's
fuel their alliances added up to and how they compare with other scouts on the same robot. Logic:
`src/lib/scouting/scoutAccuracy.js`.


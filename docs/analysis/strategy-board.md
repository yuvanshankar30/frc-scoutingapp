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
- **Matches tab:** when to plan strategy with each alliance before our next matches (see below).

Numbers come from the EPA model (official scores anchored to match scouting, [epa](epa.md)), match and pit
scouting, and TBA rankings. The old Matches tab is gone: our upcoming matches are in the overview, and any team's
next matches are in its brief.

### Matches tab

For each of our next six matches, a card with our partners and four steps, counted in matches from the TBA schedule
(`src/lib/scouting/meetingPlan.js`, shown by `StrategyMeetings.svelte`):

1. **Set a meeting time**, about 10 matches before: find or text someone on each partner team. Each partner shows
   their strat person's phone from pit scouting, with **Text** and call links.
2. **Strategy meeting**: the best gap between steps 1 and 3. A team counts as busy while it queues (two matches
   before it plays), plays, or walks back from the field (the match after). The latest slot where all three teams are
   free wins; if none is, the slot with the fewest busy teams, and the card names who is busy.
3. **Send our strategy to the pit crew**, about 5 matches before, so they can check every robot can do its part.
4. **Tell the drive coach**, 10 minutes (1-2 matches) before our match.

Each step shows the match it lines up with and its expected time. Steps whose slot has gone by are dimmed and the
next one is highlighted (re-checked every minute). When we play early in the schedule, steps that would fall before
the first match say to do them as soon as you can. Tapping a partner opens their brief.

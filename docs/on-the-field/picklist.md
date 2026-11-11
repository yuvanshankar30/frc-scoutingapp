# Picklist

`/picklist`: one shared alliance-selection list the whole team edits, as a compact table with notes and our scouting
data beside each team. API: `/api/scouting-picklist`.

## Match rankings and scores

- **Match** column: the team's place in the match-ranking consensus, from every best-to-worst order saved on
  [Match Rankings](../analysis/rankings.md) (each order counts as head-to-heads: `A > B > C` is
  A beat B, A beat C, B beat C). The small number is how many head-to-heads it has been in. `-` means nobody ranked it.
- **Auto rank** has a **Match rankings** slider next to Performance, Notes, Reliability and OPR. It blends that
  consensus (the share of head-to-heads won, 0-100) into Scout Power (`blendMatchRankings()` in
  [scoutingStats.js](../../src/lib/scouting/scoutingStats.js)); a team nobody ranked keeps its Scout Power. The number
  beside each auto-ranked team is that blended score.
- The scores and match rankings **refresh every minute** while the page is open, so new reports and rankings show up
  without a reload. The list order never changes on its own: drag it, or use **Replace the list with this order** to
  take the auto rank's order.

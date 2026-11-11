// The numbers the Picklist shows beside each team, gathered in one place so the
// page only has to lay them out. Everything here is derived from data other
// tabs already compute (Strategy rows, Power Rankings, TBA event rankings);
// nothing is stored.

const teamNumberOf = (teamKey) => Number(String(teamKey || '').replace(/^frc/i, ''));

function officialRankByTeamKey(officialRankings) {
  const byTeam = new Map();
  for (const row of officialRankings || []) {
    const rank = Number(row?.rank);
    if (row?.team_key && Number.isFinite(rank)) byTeam.set(row.team_key, rank);
  }
  return byTeam;
}

/**
 * @param {object} input
 * @param {Array} input.strategyRows      buildStrategyRows() output (our scouting data per team)
 * @param {Array} input.powerRankings     buildPowerRankings() output (key, scoutPower, powerRank), optionally
 *                                        with applyPairwiseConsensus() fields (humanRank, humanVoteCount)
 * @param {Array} input.officialRankings  TBA event rankings rows ({ team_key, rank })
 * @param {string} input.ourTeamKey       e.g. 'frc254'
 * @returns {{ byTeam: Map<string, object>, ourRank: number|null, aboveUs: string[] }}
 *   aboveUs lists, best rank first, the teams whose official rank is better than
 *   ours - the ones that will be picking (and being picked) before us.
 */
export function buildPicklistInsights({
  strategyRows = [],
  powerRankings = [],
  officialRankings = [],
  ourTeamKey = ''
}) {
  const officialByTeam = officialRankByTeamKey(officialRankings);
  const ourRank = officialByTeam.get(ourTeamKey) ?? null;
  const powerByTeam = new Map((powerRankings || []).map((team) => [team.key, team]));
  const rowByTeam = new Map((strategyRows || []).map((row) => [row.teamKey, row]));

  const teamKeys = new Set([...rowByTeam.keys(), ...powerByTeam.keys(), ...officialByTeam.keys()]);
  const byTeam = new Map();
  for (const teamKey of teamKeys) {
    const row = rowByTeam.get(teamKey);
    const power = powerByTeam.get(teamKey);
    const officialRank = officialByTeam.get(teamKey) ?? null;
    byTeam.set(teamKey, {
      teamKey,
      teamNumber: teamNumberOf(teamKey),
      isUs: teamKey === ourTeamKey,
      officialRank,
      aboveUs: ourRank != null && officialRank != null && teamKey !== ourTeamKey && officialRank < ourRank,
      powerRank: power?.powerRank ?? null,
      scoutPower: power?.scoutPower ?? null,
      // Place in the match-ranking consensus (best-to-worst orders saved on Match Rankings), null if never ranked.
      matchRank: power?.humanRank ?? null,
      matchRankVotes: power?.humanVoteCount ?? 0,
      driverSkill: row?.matchScoutSummary?.avgDriverSkill ?? null,
      drivingRank: row?.performance?.avgDrivingRank ?? null,
      timesBroken: row?.matchScoutSummary?.timesBroken ?? 0,
      openProblems: row?.openProblems?.length ?? 0,
      matchesScouted: row?.matchScoutSummary?.matchesScouted ?? 0,
      avgBallsScored: row?.matchScoutSummary?.avgBallsScored ?? null
    });
  }

  const aboveUs = [...byTeam.values()]
    .filter((team) => team.aboveUs)
    .sort((first, second) => first.officialRank - second.officialRank)
    .map((team) => team.teamKey);
  return { byTeam, ourRank, aboveUs };
}

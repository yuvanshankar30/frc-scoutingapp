import { buildPowerRankings, summarizeMatchScoutEntries } from '$lib/scouting/scoutingStats.js';
import { buildCustomExport, buildExport, buildQueryExport, DATASETS } from './exports.js';
import { BUILDERS, MAX_PROPOSALS } from './actions.js';
import { listTables, queryTable } from './queryTable.js';
import { loadPicklist, loadPractice, loadRankings, loadVotes, tbaGet } from './eventData.js';
import { eventDirectory, isNumberLike, resolveTeam, teamNumberOf } from './teamNames.js';
import { matchupOdds, roleHints, watchList } from './matchup.js';
import { mean, round } from '$lib/stats.js';

// The assistant's tools: small, read-only questions over one event snapshot. Each returns plain JSON the model
// can quote. Output is capped, because a tool result is text the model reads, not a database dump. Scout
// notes are free text written by people, so they are returned as quoted data and the system prompt tells the
// model never to follow instructions found inside them.

const MAX_ROWS = 25;
const MAX_TEXT = 280;
const clip = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
export const teamKeyOf = (value) => {
  const digits = String(value ?? '').match(/\d+/)?.[0];
  return digits ? `frc${Number(digits)}` : null;
};
const numberOf = (key) => String(key || '').replace(/^frc/i, '');

/** Every team that appears in any scouting data for the event. */
export function teamsInSnapshot(snapshot) {
  const keys = new Set();
  for (const list of [snapshot.events, snapshot.matchEntries, snapshot.notes, snapshot.problems, snapshot.pitEntries]) {
    for (const row of list || []) if (row?.team_key) keys.add(row.team_key);
  }
  return [...keys].sort((a, b) => Number(numberOf(a)) - Number(numberOf(b)));
}

/** Power-ranking rows for every team (the same scoring the Power Rankings page uses). Memoised per snapshot. */
export function rankedTeams(snapshot) {
  if (snapshot._ranked) return snapshot._ranked;
  const teams = teamsInSnapshot(snapshot).map((key) => ({ key, team_number: Number(numberOf(key)) }));
  snapshot._ranked = buildPowerRankings(teams, snapshot.events, snapshot.notes, {
    pitEntries: snapshot.pitEntries,
    problemReports: snapshot.problems,
    matchEntries: snapshot.matchEntries
  });
  return snapshot._ranked;
}

function compact(row) {
  const m = row.matchScoutSummary || {};
  return {
    team: numberOf(row.key),
    power_rank: row.powerRank ?? null,
    scout_power: round(row.scoutPower, 1),
    avg_balls_scored: round(m.avgBallsScored, 1),
    avg_auto_points: round(m.avgAutoPoints, 1),
    avg_driver_skill: round(m.avgDriverSkill, 1),
    shot_accuracy_rating: round(m.ratingAverages?.['Shot accuracy'], 1),
    cycle_speed_rating: round(m.ratingAverages?.['Cycle speed'], 1),
    reliability_rating: round(m.ratingAverages?.Reliability, 1),
    auto_run_rate: round(m.autoRunRate),
    incident_rate: round(m.incidentRate),
    times_broken: m.timesBroken ?? 0,
    matches_scouted: m.matchesScouted ?? 0,
    open_problems: row.pitSummary?.openProblemCount ?? 0,
    pit_archetype: row.pitSummary?.robotArchetype || null,
    pit_estimated_bps: round(row.pitSummary?.estimatedBps, 1),
    top_roles: Object.entries(m.roleCounts || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([role]) => role)
  };
}

const SORTS = {
  scout_power: (r) => r.scout_power,
  avg_balls_scored: (r) => r.avg_balls_scored,
  avg_auto_points: (r) => r.avg_auto_points,
  avg_driver_skill: (r) => r.avg_driver_skill,
  shot_accuracy_rating: (r) => r.shot_accuracy_rating,
  cycle_speed_rating: (r) => r.cycle_speed_rating,
  reliability_rating: (r) => r.reliability_rating,
  incident_rate: (r) => r.incident_rate,
  times_broken: (r) => r.times_broken,
  matches_scouted: (r) => r.matches_scouted
};
const LOWER_IS_BETTER = new Set(['incident_rate', 'times_broken']);

export const TOOLS = [
  {
    name: 'rank_teams',
    description:
      'Rank the teams at this event by one scouting metric. Use for "who are the best X" questions. Teams with no data for the metric are left out.',
    parameters: {
      type: 'object',
      properties: {
        sort_by: {
          type: 'string',
          enum: Object.keys(SORTS),
          description: 'Metric to rank by. scout_power is the overall score.'
        },
        limit: { type: 'integer', description: `How many teams to return (max ${MAX_ROWS}).` },
        worst_first: {
          type: 'boolean',
          description:
            'Reverse the order (worst first). For incident_rate and times_broken the default already lists the best, meaning lowest, first.'
        }
      },
      required: ['sort_by']
    }
  },
  {
    name: 'team_report',
    description:
      'Everything scouted about one team at this event: numbers, pit scouting, open problems, and recent scout notes.',
    parameters: {
      type: 'object',
      properties: { team: { type: 'string', description: 'Team number, e.g. "254" or "frc254".' } },
      required: ['team']
    }
  },
  {
    name: 'compare_teams',
    description: 'Side-by-side scouting numbers for two to six teams.',
    parameters: {
      type: 'object',
      properties: { teams: { type: 'array', items: { type: 'string' }, description: 'Team numbers.' } },
      required: ['teams']
    }
  },
  {
    name: 'search_notes',
    description:
      'Search ALL free text for a word or phrase, optionally for one team: scout notes, match-report comments (teleop, post-match, crash and collision notes), pit profile notes, pit problem reports and picklist notes. Each hit says where it came from and who wrote it.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' }, team: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query']
    }
  },
  {
    name: 'open_problems',
    description: 'Unresolved pit problem reports, most severe first. Optionally for one team.',
    parameters: { type: 'object', properties: { team: { type: 'string' } } }
  },
  {
    name: 'team_match_reports',
    description: "One team's match-by-match scouting reports (balls scored, auto, role, incidents).",
    parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] }
  },
  {
    name: 'scouts',
    description:
      'The people who scouted: names with how many match reports, notes and pit profiles each wrote. With a team: who scouted that team and in which matches. Names only; roles and accounts are not available.',
    parameters: {
      type: 'object',
      properties: { team: { type: 'string', description: 'Team number. Omit for everyone.' } }
    }
  },
  {
    name: 'match_overview',
    description:
      "Everything about one match: the teams scouted, each scout's report summary, notes, the group's post-match ranking of the robots, and the official result when available.",
    parameters: {
      type: 'object',
      properties: {
        match: { type: 'string', description: 'e.g. "qm12", "12", "Quals 12", or a full key like 2026cc_qm12.' }
      },
      required: ['match']
    }
  },
  {
    name: 'match_rankings',
    description:
      "The scouting group's post-match best-to-worst orderings of robots, and head-to-head votes. For a team: its positions in each match. For a match: the order. With neither: robots by average position.",
    parameters: { type: 'object', properties: { team: { type: 'string' }, match: { type: 'string' } } }
  },
  {
    name: 'picklist',
    description: 'The shared alliance-selection picklist in order, with notes.',
    parameters: { type: 'object', properties: { limit: { type: 'integer' } } }
  },
  {
    name: 'event_results',
    description:
      'Official results from The Blue Alliance for this event: kind "rankings", "oprs" or "matches" (match results and scores), optionally for one team.',
    parameters: {
      type: 'object',
      properties: { kind: { type: 'string', enum: ['rankings', 'oprs', 'matches'] }, team: { type: 'string' } },
      required: ['kind']
    }
  },
  {
    name: 'export_csv',
    description: `Prepare a CSV of ONE kind of event data for the person to download, narrowed to exactly what they asked for: optionally some teams, some matches and some columns. It appears as a file card under your answer; you never see the file. dataset is one of: ${Object.keys(DATASETS).join(', ')}. Useful match_reports columns: match_key, team_key, scout, alliance, balls_scored_average, auto_points_average, auto_moved, driver_skill, teleop_roles, crash_or_break, teleop_notes, post_notes. If a column name is wrong the error lists the real ones.`,
    parameters: {
      type: 'object',
      properties: {
        dataset: { type: 'string', enum: Object.keys(DATASETS) },
        team: { type: 'string', description: 'One team number.' },
        teams: { type: 'array', items: { type: 'string' }, description: 'Several team numbers.' },
        matches: { type: 'array', items: { type: 'string' }, description: 'Matches, e.g. ["qm1","qm14"].' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only these columns, in this order. Omit for all.'
        }
      },
      required: ['dataset']
    }
  },
  {
    name: 'export_query_csv',
    description:
      'Prepare a CSV from a query_table-style read (any readable table, filters, order, up to 5000 rows) when no dataset fits the request.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { column: { type: 'string' }, op: { type: 'string' }, value: { type: 'string' } },
            required: ['column', 'op', 'value']
          }
        },
        order_by: { type: 'string' },
        descending: { type: 'boolean' },
        limit: { type: 'integer' },
        filename: { type: 'string' }
      },
      required: ['table']
    }
  },
  {
    name: 'export_table_csv',
    description:
      'Prepare a CSV from a table you assembled yourself from tool results (for example "top 10 teams by auto points with their pit archetype"). Use real values from tool results only. Up to 1000 rows and 30 columns.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        rows: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Each row is an array of cell values in column order.'
        }
      },
      required: ['filename', 'columns', 'rows']
    }
  },
  {
    name: 'list_tables',
    description: 'The scouting tables query_table can read, with what each holds.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'query_table',
    description:
      'Read rows from one scouting table when no other tool answers the question. Scoped to this event. Filters: [{column, op (eq, neq, gt, gte, lt, lte, like, ilike), value}]. Max 100 rows; use count_only for a count. Account, role and admin data are not readable.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string' },
        columns: { type: 'array', items: { type: 'string' } },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { column: { type: 'string' }, op: { type: 'string' }, value: { type: 'string' } },
            required: ['column', 'op', 'value']
          }
        },
        order_by: { type: 'string' },
        descending: { type: 'boolean' },
        limit: { type: 'integer' },
        count_only: { type: 'boolean' }
      },
      required: ['table']
    }
  },
  {
    name: 'propose_add_note',
    description:
      "PROPOSE adding a scout note on a team in a match. Nothing is saved until the person presses Confirm. impact is -2 (hurts the team's ranking) to 2 (helps), default 0.",
    parameters: {
      type: 'object',
      properties: {
        team: { type: 'string' },
        match: { type: 'string', description: 'e.g. qm12' },
        note: { type: 'string' },
        impact: { type: 'integer' }
      },
      required: ['team', 'match', 'note']
    }
  },
  {
    name: 'propose_picklist_add',
    description:
      'PROPOSE adding a team to the end of the picklist, optionally with a picklist note (do both in this one call; never promise a second step). Not done until the person confirms.',
    parameters: {
      type: 'object',
      properties: { team: { type: 'string' }, note: { type: 'string' } },
      required: ['team']
    }
  },
  {
    name: 'propose_picklist_add_many',
    description:
      'PROPOSE adding several teams (up to 12) to the end of the picklist. Not done until the person confirms.',
    parameters: {
      type: 'object',
      properties: { teams: { type: 'array', items: { type: 'string' } } },
      required: ['teams']
    }
  },
  {
    name: 'propose_picklist_reorder',
    description:
      'PROPOSE putting the listed teams at the top of the picklist in the given order (others keep their order below). Use for "sort the picklist by ...". Not done until the person confirms.',
    parameters: {
      type: 'object',
      properties: { teams: { type: 'array', items: { type: 'string' } } },
      required: ['teams']
    }
  },
  {
    name: 'propose_picklist_remove',
    description: 'PROPOSE removing a team from the picklist. Not done until the person confirms.',
    parameters: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] }
  },
  {
    name: 'propose_picklist_move',
    description:
      'PROPOSE moving a team to a position on the picklist (1 is first). Not done until the person confirms.',
    parameters: {
      type: 'object',
      properties: { team: { type: 'string' }, position: { type: 'integer' } },
      required: ['team', 'position']
    }
  },
  {
    name: 'propose_picklist_note',
    description:
      'PROPOSE setting (or clearing, with an empty note) the picklist note for a team. Not done until the person confirms.',
    parameters: {
      type: 'object',
      properties: { team: { type: 'string' }, note: { type: 'string' } },
      required: ['team', 'note']
    }
  },
  {
    name: 'find_team',
    description:
      'Look up a team by NAME (for example "Citrus" or "Cheesy Poofs") to get its number, or confirm a number\'s name. Every other tool already accepts team names, so use this only when you need the number itself or are unsure which team a name means.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'A team name or number.' } },
      required: ['query']
    }
  },
  {
    name: 'alliance_matchup',
    description:
      'The one-call answer for "how do we play against X" and "what are our chances" questions. Give our alliance and the opposing alliance (one to three teams each, numbers or names). Returns each robot\'s scouted scoring, auto (average points, start positions, recorded auto routines), reliability, roles, pit details, open problems and official OPR; each alliance\'s expected total; a rough win-chance range with how much to trust it; role hints for our alliance; and which opposing robots to plan around. Call this first, then at most one or two team_report calls for detail.',
    parameters: {
      type: 'object',
      properties: {
        our_alliance: {
          type: 'array',
          items: { type: 'string' },
          description: 'Our alliance: team numbers or names, including our own team when it is us.'
        },
        opponents: {
          type: 'array',
          items: { type: 'string' },
          description: 'The opposing alliance: team numbers or names.'
        }
      },
      required: ['our_alliance', 'opponents']
    }
  },
  {
    name: 'event_overview',
    description:
      'How much scouting data exists for this event: teams, reports, notes, problems. Call first when unsure what is available.',
    parameters: { type: 'object', properties: {} }
  }
];

/** A dataset the snapshot already holds (tests, or loaded up front), else loaded once on first use and remembered. */
async function dataset(snapshot, name, loader) {
  if (snapshot[name] !== undefined) return snapshot[name];
  snapshot._lazy ||= new Map();
  if (!snapshot._lazy.has(name)) snapshot._lazy.set(name, snac(snapshot, loader));
  return snapshot._lazy.get(name);
}
const snac = async (snapshot, loader) => (snapshot.ctx ? loader(snapshot.ctx) : []);

/** "qm12", "12", "Quals 12" or a full key -> the event's match key; null when it is not recognisable. */
export function matchKeyOf(snapshot, input) {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!text) return null;
  const full = text.match(/^\d{4}[a-z0-9]+_((?:qm|ef|qf|sf|f)\d+(?:m\d+)?)$/);
  if (full) return text;
  const short = text.match(/^(?:quals?|qm)?(\d+)$/);
  if (short) return `${snapshot.eventKey}_qm${short[1]}`;
  const level = text.match(/^((?:ef|qf|sf|f)\d+(?:m\d+)?)$/);
  return level ? `${snapshot.eventKey}_${level[1]}` : null;
}
const matchLabel = (key) =>
  String(key || '')
    .replace(/^.*_/, '')
    .replace(/^qm/, 'Quals ')
    .replace(/^(ef|qf|sf)(\d+)m(\d+)$/, (_, l, a, b) => `${l.toUpperCase()} ${a} match ${b}`)
    .replace(/^f(\d+)m(\d+)$/, 'Finals $1 match $2');
const matchNumber = (key) => Number(String(key).match(/qm(\d+)/)?.[1]) || 0;
const byMatch = (a, b) => matchNumber(a) - matchNumber(b) || String(a).localeCompare(String(b));
const scoutOf = (row) => row?.scout || row?.scout_name || null;
const textOf = (row) => clip(row?.notes ?? row?.note ?? row?.text);

/** Turn a built export into a tool result: a summary for the model, the file itself for the person. */
function exported(built, what) {
  if (!built.ok) return { error: built.error };
  return {
    exported: what,
    rows: built.rows,
    columns: built.columns,
    filename: built.filename,
    note: 'The file is attached under your answer as a file card with a download button.',
    __download: { filename: built.filename, mime: 'text/csv;charset=utf-8', content: built.content, rows: built.rows }
  };
}
const dataset_ = (name, snapshot, loader) => dataset(snapshot, name, loader);

/** Build a proposal through actions.js (which validates everything) and attach it for the person to confirm. */
async function propose(kind, snapshot, args, needsRows = false) {
  if ((snapshot._proposed = (snapshot._proposed || 0) + 1) > MAX_PROPOSALS)
    return { error: `At most ${MAX_PROPOSALS} actions can be proposed per answer.` };
  const rows = needsRows ? await dataset(snapshot, 'picklist', loadPicklist) : [];
  const built = BUILDERS[kind]({ eventKey: snapshot.eventKey, rows, ...args });
  if (built.error) {
    snapshot._proposed -= 1;
    return { error: built.error };
  }
  return {
    proposed: true,
    summary: built.proposal.summary,
    status: 'Waiting for the person to press Confirm. Nothing has been changed yet.',
    __proposal: built.proposal
  };
}

const need = (key, team) =>
  key
    ? null
    : {
        error: `"${team}" is not a team number, and no team at this event matched that name. Call find_team to look it up.`
      };

// ---- alliance_matchup ----
const BALLS_PER_MATCH = (entries) => {
  const byMatch = new Map();
  for (const entry of entries) byMatch.set(entry.match_key, [...(byMatch.get(entry.match_key) || []), entry]);
  return [...byMatch.values()].map((list) => summarizeMatchScoutEntries(list).avgBallsScored).filter(Number.isFinite);
};

async function nameMap(snapshot) {
  return new Map((await eventDirectory(snapshot)).map((e) => [e.key, e.nickname]));
}

function oprMap(snapshot) {
  if (!snapshot._oprs)
    snapshot._oprs = (async () =>
      (snapshot.ctx ? (await tbaGet(snapshot.ctx, `/event/${snapshot.eventKey}/oprs`))?.oprs : null) || {})();
  return snapshot._oprs;
}

function matchupProfile(snapshot, key, oprs, names) {
  const entries = snapshot.matchEntries.filter((r) => r.team_key === key);
  const summary = summarizeMatchScoutEntries(entries);
  const series = BALLS_PER_MATCH(entries);
  const pit = snapshot.pitEntries.find((e) => e.team_key === key) || null;
  const count = (list) =>
    Object.entries(list.reduce((acc, v) => (v ? { ...acc, [v]: (acc[v] || 0) + 1 } : acc), {}))
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => ({ name, matches: n }));
  return {
    key,
    team: numberOf(key),
    name: names.get(key) || null,
    matches: summary.matchesScouted,
    balls: entries.length ? summary.avgBallsScored : null,
    ballSeries: series,
    auto: summary.avgAutoPoints,
    incidentRate: summary.incidentRate,
    defense: summary.ratingAverages?.Defense ?? null,
    shuttlingRate: summary.shuttlingRate,
    opr: Number.isFinite(oprs[key]) ? oprs[key] : null,
    summary,
    pit,
    startPositions: count(entries.map((r) => r.starting_position)).slice(0, 3),
    problems: snapshot.problems
      .filter((p) => p.team_key === key && !p.resolved)
      .slice(0, 3)
      .map((p) => clip(`${p.severity || ''} ${p.summary || ''}`)),
    latestNote: clip(snapshot.notes.find((n) => n.team_key === key)?.notes) || null
  };
}

function matchupBrief(p) {
  if (!p.matches)
    return {
      team: p.team,
      name: p.name,
      matches_scouted: 0,
      opr: round(p.opr, 1),
      note: 'No scouting data for this team at this event.'
    };
  const s = p.summary;
  return {
    team: p.team,
    name: p.name,
    matches_scouted: p.matches,
    avg_balls_scored: round(p.balls, 1),
    balls_range: p.ballSeries.length
      ? [round(Math.min(...p.ballSeries), 0), round(Math.max(...p.ballSeries), 0)]
      : null,
    opr: round(p.opr, 1),
    top_roles: Object.entries(s.roleCounts || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r]) => r),
    shuttling_rate: round(p.shuttlingRate),
    ratings: Object.fromEntries(
      Object.entries(s.ratingAverages || {})
        .filter(([, v]) => Number.isFinite(v))
        .map(([k, v]) => [k, round(v, 1)])
    ),
    incident_rate: round(p.incidentRate),
    times_broken: s.timesBroken ?? 0,
    open_problems: p.problems,
    auto: {
      avg_points: round(p.auto, 1),
      ran_rate: round(s.autoRunRate),
      collision_rate: round(s.collisionRate),
      start_positions: p.startPositions,
      collects_from: Object.entries(s.ballSourceCounts || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k),
      recorded_routines: (p.pit?.auto_options || [])
        .slice(0, 3)
        .map((o) => ({ name: clip(o.name), description: clip(o.description) }))
    },
    pit: p.pit
      ? {
          shooter: p.pit.shooter_type || null,
          hopper: p.pit.hopper_type || null,
          drivebase: p.pit.drivebase_type || null,
          climb_options: p.pit.climb_options || [],
          estimated_bps: p.pit.estimated_bps ?? null,
          likely_to_break: clip(p.pit.likely_breaking_component) || null
        }
      : null,
    latest_note: p.latestNote
  };
}

// ---- team names in arguments ----
const TEAM_ARG = ['team'];
const TEAM_LIST_ARGS = ['teams', 'our_alliance', 'opponents'];

/** Replace team names in tool arguments with numbers, so every tool understands "Citrus" as well as "1678". */
async function resolveTeamArgs(snapshot, args) {
  const next = { ...args };
  const resolved = {};
  const prefer = new Set(teamsInSnapshot(snapshot));
  const fix = async (value) => {
    if (typeof value !== 'string' || !value.trim() || isNumberLike(value)) return { value };
    const found = await resolveTeam(snapshot, value, prefer);
    if (found.key) {
      resolved[value] = `${teamNumberOf(found.key)}${found.nickname ? ` (${found.nickname})` : ''}`;
      return { value: teamNumberOf(found.key) };
    }
    if (found.candidates.length > 1)
      return {
        error: `"${value}" could mean several teams: ${found.candidates.map((c) => `${c.team} ${c.nickname}`).join('; ')}. Ask the person which one, or use the number.`
      };
    return { value };
  };
  for (const name of TEAM_ARG) {
    if (next[name] === undefined) continue;
    const out = await fix(next[name]);
    if (out.error) return { error: out.error };
    next[name] = out.value;
  }
  for (const name of TEAM_LIST_ARGS) {
    if (!Array.isArray(next[name])) continue;
    const list = [];
    for (const item of next[name]) {
      const out = await fix(item);
      if (out.error) return { error: out.error };
      list.push(out.value);
    }
    next[name] = list;
  }
  return { args: next, resolved };
}

const IMPLEMENTATIONS = {
  async find_team(snapshot, { query } = {}) {
    const found = await resolveTeam(snapshot, query, new Set(teamsInSnapshot(snapshot)));
    const have = new Set(teamsInSnapshot(snapshot));
    if (found.how === 'number') return { query, team: numberOf(found.key), scouted_at_this_event: have.has(found.key) };
    if (!found.key && !found.candidates.length)
      return { query, matches: [], note: 'No team matched that name. Ask the person for the team number.' };
    const rows = (
      found.key && !found.candidates.some((c) => c.team === numberOf(found.key))
        ? [{ team: numberOf(found.key), nickname: found.nickname, at_this_event: true }]
        : []
    ).concat(found.candidates);
    return {
      query,
      best_match: found.key ? numberOf(found.key) : null,
      ambiguous: !found.key,
      matches: rows.map((c) => ({ ...c, scouted_at_this_event: have.has(`frc${c.team}`) }))
    };
  },

  async alliance_matchup(snapshot, { our_alliance, opponents } = {}) {
    const keysOf = (list) => [...new Set((Array.isArray(list) ? list : []).map(teamKeyOf).filter(Boolean))].slice(0, 3);
    const ours = keysOf(our_alliance);
    const theirs = keysOf(opponents);
    if (!ours.length || !theirs.length)
      return {
        error:
          'Give one to three teams for each alliance (numbers or names). If a name was not understood, call find_team.'
      };
    const both = ours.filter((k) => theirs.includes(k));
    if (both.length) return { error: `Team ${numberOf(both[0])} cannot be on both alliances.` };
    const [oprs, names] = await Promise.all([oprMap(snapshot), nameMap(snapshot)]);
    const build = (keys) => keys.map((k) => matchupProfile(snapshot, k, oprs, names));
    const o = build(ours);
    const t = build(theirs);
    const ranked = rankedTeams(snapshot)
      .map(compact)
      .map((r) => r.avg_balls_scored)
      .filter(Number.isFinite);
    return {
      our_alliance: o.map(matchupBrief),
      opponents: t.map(matchupBrief),
      event_average_balls_per_team: ranked.length ? round(ranked.reduce((a, b) => a + b, 0) / ranked.length, 1) : null,
      ...matchupOdds(o, t),
      role_hints: roleHints(o),
      watch_list: watchList(t)
    };
  },

  event_overview(snapshot) {
    return {
      event: snapshot.eventKey,
      teams_with_data: teamsInSnapshot(snapshot).length,
      match_reports: snapshot.matchEntries.length,
      matches_scouted: new Set(snapshot.matchEntries.map((r) => r.match_key)).size,
      quick_scout_events: snapshot.events.length,
      notes: snapshot.notes.length,
      pit_profiles: snapshot.pitEntries.length,
      open_problems: snapshot.problems.filter((p) => !p.resolved).length
    };
  },

  rank_teams(snapshot, { sort_by, limit = 10, worst_first = false }) {
    const pick = SORTS[sort_by];
    if (!pick) return { error: `Unknown metric. Use one of: ${Object.keys(SORTS).join(', ')}.` };
    const rows = rankedTeams(snapshot)
      .map(compact)
      .filter((r) => Number.isFinite(pick(r)));
    const lowBest = LOWER_IS_BETTER.has(sort_by);
    rows.sort((a, b) => (lowBest ? pick(a) - pick(b) : pick(b) - pick(a)) * (worst_first ? -1 : 1));
    const n = Math.min(Math.max(1, Math.trunc(limit) || 10), MAX_ROWS);
    return {
      sorted_by: sort_by,
      direction: lowBest !== worst_first ? 'lowest first' : 'highest first',
      teams_with_data: rows.length,
      results: rows.slice(0, n)
    };
  },

  team_report(snapshot, { team }) {
    const key = teamKeyOf(team);
    const bad = need(key, team);
    if (bad) return bad;
    const row = rankedTeams(snapshot).find((r) => r.key === key);
    if (!row) return { error: `No scouting data for team ${numberOf(key)} at this event.` };
    const notes = snapshot.notes
      .filter((n) => n.team_key === key)
      .slice(0, 8)
      .map((n) => ({
        match: n.match_key,
        scout: scoutOf(n),
        impact: n.ranking_impact ?? null,
        text: clip(n.notes ?? n.note ?? n.text)
      }));
    const problems = snapshot.problems
      .filter((p) => p.team_key === key)
      .slice(0, 8)
      .map((p) => ({
        severity: p.severity,
        resolved: Boolean(p.resolved),
        summary: clip(p.summary),
        detail: clip(p.detail)
      }));
    const pit = snapshot.pitEntries.find((e) => e.team_key === key);
    return {
      summary: compact(row),
      pit: pit
        ? {
            archetype: pit.robot_archetype || null,
            climb_options: pit.climb_options || [],
            estimated_bps: pit.estimated_bps ?? null,
            notes: clip(pit.additional_notes)
          }
        : null,
      scouted_by: [
        ...new Set(
          snapshot.matchEntries
            .filter((e) => e.team_key === key)
            .map(scoutOf)
            .filter(Boolean)
        )
      ],
      note_count: row.noteSummary?.noteCount ?? 0,
      recent_notes: notes,
      problems
    };
  },

  compare_teams(snapshot, { teams }) {
    const keys = [...new Set((teams || []).map(teamKeyOf).filter(Boolean))].slice(0, 6);
    if (keys.length < 2) return { error: 'Give two to six team numbers.' };
    const ranked = rankedTeams(snapshot);
    return {
      teams: keys.map((k) => {
        const r = ranked.find((x) => x.key === k);
        return r ? compact(r) : { team: numberOf(k), error: 'no scouting data' };
      })
    };
  },

  async search_notes(snapshot, { query, team, limit = 10 }) {
    const needle = String(query || '')
      .trim()
      .toLowerCase();
    if (!needle) return { error: 'query is required.' };
    const key = team ? teamKeyOf(team) : null;
    const n = Math.min(Math.max(1, Math.trunc(limit) || 10), MAX_ROWS);
    const hits = [];
    const add = (kind, row, text, extra = {}) => {
      if ((!key || row.team_key === key) && text.toLowerCase().includes(needle))
        hits.push({
          kind,
          team: row.team_key ? numberOf(row.team_key) : null,
          match: row.match_key || null,
          scout: scoutOf(row),
          ...extra,
          text
        });
    };
    for (const note of snapshot.notes) add('note', note, textOf(note));
    for (const e of snapshot.matchEntries)
      for (const [field, value] of [
        ['teleop_notes', e.teleop_notes],
        ['post_notes', e.post_notes],
        ['crash_details', e.crash_details],
        ['auto_collision_notes', e.auto_collision_notes]
      ])
        if (value) add('match_report', e, clip(value), { field });
    for (const p of snapshot.problems)
      add('pit_problem', p, clip(`${p.summary} ${p.detail || ''}`), {
        severity: p.severity,
        resolved: Boolean(p.resolved)
      });
    for (const e of snapshot.pitEntries) if (e.additional_notes) add('pit_profile', e, clip(e.additional_notes));
    for (const row of await dataset(snapshot, 'picklist', loadPicklist))
      if (row.note) add('picklist_note', row, clip(row.note));
    return { matches: hits.length, results: hits.slice(0, n) };
  },

  open_problems(snapshot, { team } = {}) {
    const key = team ? teamKeyOf(team) : null;
    const order = { urgent: 0, watch: 1 };
    const rows = snapshot.problems
      .filter((p) => !p.resolved && (!key || p.team_key === key))
      .sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2))
      .slice(0, MAX_ROWS)
      .map((p) => ({
        team: numberOf(p.team_key),
        severity: p.severity,
        summary: clip(p.summary),
        detail: clip(p.detail)
      }));
    return { count: rows.length, results: rows };
  },

  async export_csv(snapshot, { dataset, team, teams, matches, columns } = {}) {
    const key = team ? teamKeyOf(team) : null;
    if (team && !key) return { error: `"${team}" is not a team number.` };
    const teamKeys = (Array.isArray(teams) ? teams : []).map(teamKeyOf);
    if (teamKeys.some((k) => !k)) return { error: 'One of the teams is not a team number.' };
    const matchKeys = (Array.isArray(matches) ? matches : []).map((m) => matchKeyOf(snapshot, m));
    if (matchKeys.some((k) => !k)) return { error: 'One of the matches is not a match (try "qm12").' };
    const extras = {
      rankings: await dataset_('rankings', snapshot, loadRankings),
      picklist: await dataset_('picklist', snapshot, loadPicklist),
      teamSummary: rankedTeams(snapshot).map(compact)
    };
    return exported(
      buildExport(dataset, snapshot, extras, {
        teamKey: key,
        teamKeys,
        matchKeys,
        columns: Array.isArray(columns) && columns.length ? columns.map(String) : null
      }),
      dataset
    );
  },

  async export_query_csv(snapshot, args = {}) {
    if (!snapshot.ctx) return { error: 'Database queries are not available here.' };
    const read = await queryTable(snapshot.ctx, args, { forExport: true });
    if (read.error) return { error: read.error };
    return exported(buildQueryExport(snapshot, read, args.filename), args.table);
  },

  async export_table_csv(snapshot, args = {}) {
    return exported(buildCustomExport(snapshot, args), 'custom table');
  },

  async propose_picklist_add_many(snapshot, { teams }) {
    return propose('picklist_add_many', snapshot, { teamKeys: (teams || []).map(teamKeyOf) }, true);
  },
  async propose_picklist_reorder(snapshot, { teams }) {
    return propose('picklist_reorder', snapshot, { teamKeys: (teams || []).map(teamKeyOf) }, true);
  },

  list_tables() {
    return listTables();
  },

  async query_table(snapshot, args) {
    if (!snapshot.ctx) return { error: 'Database queries are not available here.' };
    return queryTable(snapshot.ctx, args);
  },

  async propose_add_note(snapshot, { team, match, note, impact }) {
    return propose('add_note', snapshot, {
      teamKey: teamKeyOf(team),
      matchKey: matchKeyOf(snapshot, match),
      note,
      impact
    });
  },
  async propose_picklist_add(snapshot, { team, note }) {
    return propose('picklist_add', snapshot, { teamKey: teamKeyOf(team), note }, true);
  },
  async propose_picklist_remove(snapshot, { team }) {
    return propose('picklist_remove', snapshot, { teamKey: teamKeyOf(team) }, true);
  },
  async propose_picklist_move(snapshot, { team, position }) {
    return propose('picklist_move', snapshot, { teamKey: teamKeyOf(team), position }, true);
  },
  async propose_picklist_note(snapshot, { team, note }) {
    return propose('picklist_note', snapshot, { teamKey: teamKeyOf(team), note }, true);
  },

  async scouts(snapshot, { team } = {}) {
    const key = team ? teamKeyOf(team) : null;
    if (team && !key) return { error: `"${team}" is not a team number.` };
    if (key) {
      const mine = snapshot.matchEntries.filter((e) => e.team_key === key);
      if (!mine.length) return { error: `No match reports for team ${numberOf(key)}.` };
      const by = new Map();
      for (const e of mine) {
        const name = scoutOf(e) || 'unknown (no name on the report)';
        by.set(name, [...(by.get(name) || []), e.match_key]);
      }
      return {
        team: numberOf(key),
        reports: mine.length,
        scouts: [...by]
          .map(([name, matches]) => ({
            scout: name,
            reports: matches.length,
            matches: [...new Set(matches)].sort(byMatch).map(matchLabel)
          }))
          .sort((a, b) => b.reports - a.reports)
      };
    }
    const tally = new Map();
    const bump = (name, field) => {
      const t = tally.get(name) || { scout: name, match_reports: 0, notes: 0, pit_profiles: 0, teams: new Set() };
      t[field] += 1;
      tally.set(name, t);
      return t;
    };
    for (const e of snapshot.matchEntries) {
      const name = scoutOf(e);
      if (name) bump(name, 'match_reports').teams.add(e.team_key);
    }
    for (const e of snapshot.notes) {
      const name = scoutOf(e);
      if (name) bump(name, 'notes');
    }
    for (const e of snapshot.pitEntries) {
      const name = scoutOf(e);
      if (name) bump(name, 'pit_profiles');
    }
    const unnamed = snapshot.matchEntries.filter((e) => !scoutOf(e)).length;
    return {
      scouts: [...tally.values()]
        .map((t) => ({ ...t, teams_scouted: t.teams.size, teams: undefined }))
        .sort((a, b) => b.match_reports - a.match_reports)
        .slice(0, 60),
      reports_without_a_name: unnamed
    };
  },

  async match_overview(snapshot, { match }) {
    const key = matchKeyOf(snapshot, match);
    if (!key) return { error: `"${match}" is not a match. Try "qm12" or "Quals 12".` };
    const reports = snapshot.matchEntries.filter((e) => e.match_key === key);
    const rankings = await dataset(snapshot, 'rankings', loadRankings);
    const ranking = rankings.find((r) => r.match_key === key);
    const practice = (await dataset(snapshot, 'practice', loadPractice)).find((r) => r.match_key === key);
    const notes = snapshot.notes.filter((n) => n.match_key === key);
    let official = null;
    if (snapshot.ctx) {
      const data = await tbaGet(snapshot.ctx, `/match/${key}/simple`);
      if (data)
        official = {
          red: data.alliances?.red?.team_keys?.map(numberOf),
          blue: data.alliances?.blue?.team_keys?.map(numberOf),
          red_score: data.alliances?.red?.score,
          blue_score: data.alliances?.blue?.score,
          winner: data.winning_alliance || null
        };
    }
    if (!reports.length && !ranking && !official && !notes.length)
      return { error: `Nothing recorded for ${matchLabel(key)}.` };
    return {
      match: matchLabel(key),
      practice_label: practice?.label || null,
      official,
      group_ranking_best_to_worst: ranking ? ranking.ranked_team_keys.map(numberOf) : null,
      reports: reports.slice(0, MAX_ROWS).map((r) => ({
        team: numberOf(r.team_key),
        alliance: r.alliance || null,
        scout: scoutOf(r),
        balls_scored: r.balls_scored_average ?? r.balls_scored_band ?? null,
        auto_points: r.auto_points_average ?? r.auto_points_band ?? null,
        auto_moved: r.auto_moved ?? null,
        roles: r.teleop_roles || [],
        incident:
          r.crash_or_break === true || r.intake_jammed === true || ['disabled', 'died'].includes(r.robot_disabled),
        comments: clip([r.teleop_notes, r.post_notes, r.crash_details].filter(Boolean).join(' / ')) || null
      })),
      notes: notes.slice(0, 10).map((n) => ({ team: numberOf(n.team_key), scout: scoutOf(n), text: textOf(n) }))
    };
  },

  async match_rankings(snapshot, { team, match } = {}) {
    const rankings = await dataset(snapshot, 'rankings', loadRankings);
    const votes = await dataset(snapshot, 'votes', loadVotes);
    if (!rankings.length && !votes.length)
      return { error: 'No post-match rankings or head-to-head votes have been entered for this event.' };
    if (match) {
      const key = matchKeyOf(snapshot, match);
      const r = rankings.find((x) => x.match_key === key);
      return r
        ? { match: matchLabel(key), best_to_worst: r.ranked_team_keys.map(numberOf) }
        : { error: `No ranking was entered for ${matchLabel(key) || match}.` };
    }
    const positions = new Map();
    for (const r of rankings)
      r.ranked_team_keys.forEach((t, i) =>
        positions.set(t, [
          ...(positions.get(t) || []),
          { match_key: r.match_key, position: i + 1, of: r.ranked_team_keys.length }
        ])
      );
    const wl = new Map();
    for (const v of votes)
      for (const t of [v.team_a_key, v.team_b_key]) {
        const x = wl.get(t) || { wins: 0, losses: 0 };
        if (t === v.winner_team_key) x.wins += 1;
        else x.losses += 1;
        wl.set(t, x);
      }
    if (team) {
      const key = teamKeyOf(team);
      const bad = need(key, team);
      if (bad) return bad;
      const mine = positions.get(key) || [];
      return {
        team: numberOf(key),
        times_ranked: mine.length,
        average_position: round(mean(mine.map((p) => p.position)), 1),
        matches: mine
          .sort((a, b) => byMatch(a.match_key, b.match_key))
          .slice(0, MAX_ROWS)
          .map((p) => ({ match: matchLabel(p.match_key), position: `${p.position} of ${p.of}` })),
        head_to_head: wl.get(key) || { wins: 0, losses: 0 }
      };
    }
    const rows = [...positions]
      .map(([t, list]) => ({
        team: numberOf(t),
        times_ranked: list.length,
        average_position: round(mean(list.map((p) => p.position)), 1),
        best_in_match_count: list.filter((p) => p.position === 1).length,
        head_to_head: wl.get(t) || { wins: 0, losses: 0 }
      }))
      .filter((r) => r.times_ranked >= 2)
      .sort((a, b) => a.average_position - b.average_position)
      .slice(0, MAX_ROWS);
    return {
      note: 'Lower average position is better; teams ranked in fewer than 2 matches are left out.',
      results: rows
    };
  },

  async picklist(snapshot, { limit = 40 } = {}) {
    const rows = await dataset(snapshot, 'picklist', loadPicklist);
    if (!rows.length) return { error: 'The picklist is empty.' };
    const n = Math.min(Math.max(1, Math.trunc(limit) || 40), 60);
    return {
      count: rows.length,
      picks: [...rows]
        .sort((a, b) => a.position - b.position)
        .slice(0, n)
        .map((r, i) => ({
          position: r.position ?? i + 1,
          team: String(r.team_number ?? numberOf(r.team_key)),
          nickname: r.nickname || null,
          note: clip(r.note) || null
        }))
    };
  },

  async event_results(snapshot, { kind, team } = {}) {
    if (!snapshot.ctx) return { error: 'Official results are not available here.' };
    const key = team ? teamKeyOf(team) : null;
    if (team && !key) return { error: `"${team}" is not a team number.` };
    const ev = snapshot.eventKey;
    const failed = {
      error: 'The Blue Alliance data could not be fetched (no key configured, or the service did not answer).'
    };
    if (kind === 'rankings') {
      const data = await tbaGet(snapshot.ctx, `/event/${ev}/rankings`);
      if (!data?.rankings) return failed;
      const rows = data.rankings.filter((r) => !key || r.team_key === key).slice(0, MAX_ROWS * 2);
      return {
        results: rows.map((r) => ({
          rank: r.rank,
          team: numberOf(r.team_key),
          wins: r.record?.wins,
          losses: r.record?.losses,
          ties: r.record?.ties,
          matches_played: r.matches_played,
          ranking_score: round(r.sort_orders?.[0], 2)
        }))
      };
    }
    if (kind === 'oprs') {
      const data = await tbaGet(snapshot.ctx, `/event/${ev}/oprs`);
      if (!data?.oprs) return failed;
      const rows = Object.entries(data.oprs)
        .filter(([t]) => !key || t === key)
        .map(([t, opr]) => ({ team: numberOf(t), opr: round(opr, 1) }))
        .sort((a, b) => b.opr - a.opr)
        .slice(0, MAX_ROWS);
      return { results: rows };
    }
    if (kind === 'matches') {
      const data = await tbaGet(
        snapshot.ctx,
        key ? `/team/${key}/event/${ev}/matches/simple` : `/event/${ev}/matches/simple`
      );
      if (!Array.isArray(data)) return failed;
      const order = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
      const rows = data
        .filter((m) => m.alliances?.red?.score >= 0)
        .sort((a, b) => order[a.comp_level] - order[b.comp_level] || a.match_number - b.match_number)
        .slice(-MAX_ROWS * 2);
      return {
        results: rows.map((m) => ({
          match: `${m.comp_level.toUpperCase()} ${m.match_number}${m.set_number > 1 || m.comp_level !== 'qm' ? ` (set ${m.set_number})` : ''}`,
          red: m.alliances.red.team_keys.map(numberOf),
          blue: m.alliances.blue.team_keys.map(numberOf),
          red_score: m.alliances.red.score,
          blue_score: m.alliances.blue.score,
          winner: m.winning_alliance || null
        }))
      };
    }
    return { error: 'kind must be rankings, oprs or matches.' };
  },

  team_match_reports(snapshot, { team }) {
    const key = teamKeyOf(team);
    const bad = need(key, team);
    if (bad) return bad;
    const entries = snapshot.matchEntries.filter((r) => r.team_key === key);
    if (!entries.length) return { error: `No match reports for team ${numberOf(key)}.` };
    const summary = summarizeMatchScoutEntries(entries);
    return {
      reports: entries.length,
      avg_balls_scored: round(summary.avgBallsScored, 1),
      matches: entries.slice(0, MAX_ROWS).map((r) => ({
        match: r.match_key,
        scout: scoutOf(r),
        auto_moved: r.auto_moved ?? null,
        comments:
          clip([r.teleop_notes, r.post_notes, r.crash_details, r.auto_collision_notes].filter(Boolean).join(' / ')) ||
          null,
        balls_scored: r.balls_scored_average ?? r.balls_scored_band ?? null,
        roles: r.teleop_roles || [],
        incident:
          r.crash_or_break === true || r.intake_jammed === true || ['disabled', 'died'].includes(r.robot_disabled)
      }))
    };
  }
};

/** Run one tool by name. Never throws: a failure is returned as { error } so the model can recover or say so. */
export async function runTool(name, args, snapshot) {
  const impl = IMPLEMENTATIONS[name];
  if (!impl) return { error: `Unknown tool ${name}.` };
  try {
    const prepared = await resolveTeamArgs(snapshot, args && typeof args === 'object' ? args : {});
    if (prepared.error) return { error: prepared.error };
    const result = await impl(snapshot, prepared.args);
    return Object.keys(prepared.resolved).length && result && typeof result === 'object'
      ? { ...result, resolved_teams: prepared.resolved }
      : result;
  } catch (error) {
    return { error: `Tool failed: ${error.message}` };
  }
}

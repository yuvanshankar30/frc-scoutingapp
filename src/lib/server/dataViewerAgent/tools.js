// The analysis agent's tools. Three groups:
//   - Data Viewer tools over the event's match and pit scouting (every field, added questions included), built on the
//     same functions the Data Viewer pages use, so the agent and the pages always agree;
//   - the scouting assistant's read-only tools (notes, problems, picklist, matchups, …), reused as they are;
//   - outside sources: The Blue Alliance, FIRST's FRC Events API, Match13 and Statbotics (sources.js).
// Every tool only reads. Results are trimmed before they reach the model.
import { TOOLS as ASSISTANT_TOOLS, runTool as runAssistantTool } from '$lib/server/assistant/tools.js';
import { fieldsFor } from '$lib/scouting/dataViewerFields.js';
import {
  emptyFilters,
  entryList,
  entrySections,
  fieldTrend,
  filterRecords,
  summarizeField,
  teamNumber
} from '$lib/scouting/dataViewer.js';
import { DEFAULT_METRIC, isMetric, topScorerRows, trendRows } from '$lib/scouting/dataPage.js';
import { MATCH_METRICS } from '$lib/scouting/teamCharts.js';
import { SOURCES, fetchSource, sourceStatus } from './sources.js';

/** Most characters of one tool result the model sees; the rest is cut with a note saying so. */
export const MAX_RESULT_CHARS = 14_000;
const MAX_ROWS = 80;

// The assistant's tools that only read. Its export_* and propose_* tools hand files and actions to its own page, which
// this agent's page doesn't have.
const REUSED = ASSISTANT_TOOLS.filter((tool) => !/^(export_|propose_)/.test(tool.name));
const REUSED_NAMES = new Set(REUSED.map((tool) => tool.name));

const filterProperties = {
  teams: { type: 'array', items: { type: 'string' }, description: 'Team numbers to keep, e.g. ["5940","254"]' },
  match_type: { type: 'string', enum: ['qual', 'playoff', 'practice'] },
  from_match: { type: 'integer', description: 'First qualification match number to include' },
  to_match: { type: 'integer', description: 'Last qualification match number to include' },
  kind: { type: 'string', enum: ['data', 'performance', 'robot'], description: 'Only this kind of match report' }
};

const OWN_TOOLS = [
  {
    name: 'list_fields',
    description:
      'Every question on the match or pit scouting form (built-in and added by admins): id, label, section, answer type and which kind of match report asks it. Call this first to find field ids.',
    parameters: {
      type: 'object',
      properties: { form: { type: 'string', enum: ['match', 'pit'] } },
      required: ['form']
    }
  },
  {
    name: 'field_summary',
    description:
      "One scouting field across the event: how many reports answered, the event average/min/max (numbers, ratings), share of Yes (yes/no) or answer counts (choices), and each team's numbers. Blanks are not scouted, never 0.",
    parameters: {
      type: 'object',
      properties: {
        form: { type: 'string', enum: ['match', 'pit'] },
        field_id: { type: 'string' },
        ...filterProperties
      },
      required: ['form', 'field_id']
    }
  },
  {
    name: 'team_fields',
    description:
      "Everything scouted about one team, field by field: its average/range, share of Yes, most common answers or written answers for every match or pit field it has answers for. Use for a team's full profile.",
    parameters: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Team number, e.g. "5940"' },
        form: { type: 'string', enum: ['match', 'pit'] },
        ...filterProperties
      },
      required: ['team']
    }
  },
  {
    name: 'field_trend',
    description:
      "Who is improving on a match scouting number or rating field: each team's mean over its last 3 scouted matches minus its first 3 (needs 6 matches).",
    parameters: {
      type: 'object',
      properties: { field_id: { type: 'string' }, ...filterProperties },
      required: ['field_id']
    }
  },
  {
    name: 'metric_rankings',
    description: `Every team ranked on a standard match metric, plus who is improving on it. Metrics: ${Object.keys(MATCH_METRICS).join(', ')}.`,
    parameters: {
      type: 'object',
      properties: { metric: { type: 'string', enum: Object.keys(MATCH_METRICS) } },
      required: ['metric']
    }
  },
  {
    name: 'scout_entries',
    description:
      'Individual match scouting reports, latest first, each with every question its kind asked and the answer. Filter by team, match (e.g. "Qual 12") or kind.',
    parameters: {
      type: 'object',
      properties: {
        team: { type: 'string' },
        match: { type: 'string', description: 'Match label or number, e.g. "Qual 12"' },
        kind: { type: 'string', enum: ['data', 'performance', 'robot'] },
        limit: { type: 'integer', description: 'At most this many reports (default 10, max 30)' }
      }
    }
  },
  {
    name: 'list_sources',
    description:
      'Which outside data sources this server can reach right now (TBA, FIRST FRC Events, Match13, Statbotics).',
    parameters: { type: 'object', properties: {} }
  },
  ...Object.entries(SOURCES).map(([key, source]) => ({
    name: `${key}_get`,
    description: `Read ${source.label}. ${source.help}. Returns JSON. Use the event and team keys from our data.`,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  }))
];

/** Every tool the model is offered: the Data Viewer's own, then the reused assistant tools. */
export const AGENT_TOOLS = [...OWN_TOOLS, ...REUSED];

const teamKeyFrom = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? `frc${Number(digits)}` : '';
};

/** Tool filter arguments as Data Viewer filters. */
export function filtersFrom(args = {}) {
  return {
    ...emptyFilters(),
    teams: Array.isArray(args.teams) ? args.teams.map(teamKeyFrom).filter(Boolean) : [],
    matchType: ['qual', 'playoff', 'practice'].includes(args.match_type) ? args.match_type : '',
    fromMatch: Number.isInteger(args.from_match) ? args.from_match : null,
    toMatch: Number.isInteger(args.to_match) ? args.to_match : null,
    kind: ['data', 'performance', 'robot'].includes(args.kind) ? args.kind : ''
  };
}

const round = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);

function summaryForModel(summary, { teamLimit = MAX_ROWS } = {}) {
  const { field } = summary;
  const out = {
    field: { id: field.id, label: field.label, section: field.sectionLabel, type: field.type },
    reports: summary.count,
    teams: summary.teamCount
  };
  if (field.type === 'number' || field.type === 'rating')
    Object.assign(out, {
      average: round(summary.average),
      min: summary.min,
      max: summary.max,
      ...(field.max ? { scale_max: field.max } : {})
    });
  if (field.type === 'yesno') out.share_yes = round(summary.share);
  if (summary.distribution) out.answers = summary.distribution.slice(0, 20);
  if (field.type === 'text')
    out.latest_answers = summary.answers
      .slice(-15)
      .reverse()
      .map((answer) => ({ team: answer.team, match: answer.match, text: answer.text }));
  else
    out.by_team = summary.teams.slice(0, teamLimit).map((row) => ({
      team: row.team,
      reports: row.count,
      ...(row.average !== undefined ? { average: round(row.average), min: row.min, max: row.max } : {}),
      ...(row.share !== undefined ? { share_yes: round(row.share) } : {}),
      ...(row.top ? { most_common: row.top } : {})
    }));
  return out;
}

const formOf = (value) => (value === 'pit' ? 'pit' : 'match');
const findField = (snapshot, form, id) => snapshot.fields[form].find((field) => field.id === id);
const noField = (form, id) => ({ error: `No ${form} field with id "${id}". Call list_fields to see the ids.` });

const OWN = {
  list_fields: (snapshot, args) =>
    snapshot.fields[formOf(args.form)].map((field) => ({
      id: field.id,
      label: field.label,
      section: field.sectionLabel,
      type: field.type,
      ...(field.kind ? { report_kind: field.kind } : {}),
      ...(field.kinds ? { report_kinds: field.kinds } : {}),
      ...(field.custom ? { added_question: true } : {})
    })),

  field_summary(snapshot, args) {
    const form = formOf(args.form);
    const field = findField(snapshot, form, args.field_id);
    if (!field) return noField(form, args.field_id);
    return summaryForModel(summarizeField(field, filterRecords(snapshot.records[form], form, filtersFrom(args))));
  },

  team_fields(snapshot, args) {
    const form = formOf(args.form);
    const teamKey = teamKeyFrom(args.team);
    if (!teamKey) return { error: 'Give a team number.' };
    const records = filterRecords(snapshot.records[form], form, { ...filtersFrom(args), teams: [teamKey] });
    if (!records.length) return { team: teamNumber(teamKey), form, reports: 0, note: 'Not scouted on this form.' };
    const fields = snapshot.fields[form]
      .map((field) => summarizeField(field, records))
      .filter((summary) => summary.count)
      .map((summary) => {
        const out = summaryForModel(summary, { teamLimit: 0 });
        delete out.teams;
        delete out.by_team;
        return out;
      });
    return { team: teamNumber(teamKey), form, reports: records.length, fields };
  },

  field_trend(snapshot, args) {
    const field = findField(snapshot, 'match', args.field_id);
    if (!field) return noField('match', args.field_id);
    if (field.type !== 'number' && field.type !== 'rating')
      return { error: `${field.label} is not a number or rating, so it has no trend.` };
    const trend = fieldTrend(summarizeField(field, filterRecords(snapshot.records.match, 'match', filtersFrom(args))));
    return {
      field: field.label,
      improving_first: trend.rows.map((row) => ({ team: row.label, change: round(row.value), matches: row.n })),
      not_enough_matches: trend.notEnough
    };
  },

  metric_rankings(snapshot, args) {
    const metric = isMetric(args.metric) ? args.metric : DEFAULT_METRIC;
    const entries = snapshot.records.match;
    const top = topScorerRows({ entries, metric, teams: [], eventKey: snapshot.eventKey });
    const trend = trendRows({ entries, metric, eventKey: snapshot.eventKey });
    return {
      metric: MATCH_METRICS[metric].label,
      unit: MATCH_METRICS[metric].unit || '',
      lower_is_better: top.lowerIsBetter,
      ranked: top.rows.map((row, index) => ({
        rank: index + 1,
        team: row.label,
        average: round(row.value),
        matches: row.n
      })),
      improving: trend.rows.map((row) => ({ team: row.label, change: round(row.value), matches: row.n })),
      scouted_without_this_metric: top.noData
    };
  },

  scout_entries(snapshot, args) {
    const teamKey = teamKeyFrom(args.team);
    const limit = Math.min(30, Math.max(1, Number.isInteger(args.limit) ? args.limit : 10));
    const match = String(args.match || '')
      .trim()
      .toLowerCase();
    const matchNumber = match.replace(/\D/g, '');
    const entries = entryList(snapshot.records.match)
      .filter((entry) => !teamKey || entry.record.team_key === teamKey)
      .filter((entry) => !args.kind || entry.kind === args.kind)
      .filter(
        (entry) =>
          !match ||
          entry.match.toLowerCase() === match ||
          (/^\d+$/.test(match) && entry.match.toLowerCase() === `qual ${matchNumber}`)
      );
    return {
      total: entries.length,
      entries: entries.slice(0, limit).map((entry) => ({
        team: entry.team,
        match: entry.match,
        kind: entry.kind,
        scout: entry.scout,
        answers: Object.fromEntries(
          entrySections(snapshot.fields.match, entry.record).flatMap((section) =>
            section.answers.filter((answer) => answer.text !== null).map((answer) => [answer.field.label, answer.text])
          )
        )
      }))
    };
  },

  list_sources: (snapshot) => sourceStatus(snapshot.ctx?.env || {})
};

/** A tool result as text the model can read, cut to MAX_RESULT_CHARS with a note when it is longer. */
export function resultText(result) {
  const text = JSON.stringify(result ?? null);
  if (text.length <= MAX_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_CHARS)}… [cut: ${text.length - MAX_RESULT_CHARS} more characters. Ask for something narrower, e.g. a filter or a smaller path.]`;
}

/**
 * Runs one tool call: { result, source? } where source ({ source, url }) names the outside data it read, so the page
 * can list where an answer came from. Never throws.
 */
export async function runAgentTool(name, args, snapshot, { fetchImpl = fetch } = {}) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  try {
    const external = /^(\w+)_get$/.exec(name || '');
    if (external && SOURCES[external[1]]) {
      const fetched = await fetchSource(external[1], safeArgs.path, { env: snapshot.ctx?.env || {}, fetchImpl });
      return {
        result: fetched.error ? { error: fetched.error } : fetched.data,
        source: fetched.url ? { source: external[1], url: fetched.url, ok: !fetched.error } : null
      };
    }
    if (OWN[name]) return { result: await OWN[name](snapshot, safeArgs), source: { source: 'scouting' } };
    if (REUSED_NAMES.has(name))
      return { result: await runAssistantTool(name, safeArgs, snapshot), source: { source: 'scouting' } };
    return { result: { error: `Unknown tool ${name}.` } };
  } catch (error) {
    return { result: { error: `Tool failed: ${error?.message || 'unknown error'}` } };
  }
}

/** Adds what the Data Viewer tools need to an assistant snapshot: the field catalog and records by form. */
export function withDataViewer(snapshot, schemas = { match: [], pit: [] }) {
  const named = (row) => ({ ...row, scout_name: row.scout_name || row.scout || null });
  return {
    ...snapshot,
    records: { match: (snapshot.matchEntries || []).map(named), pit: (snapshot.pitEntries || []).map(named) },
    fields: { match: fieldsFor('match', schemas.match), pit: fieldsFor('pit', schemas.pit) }
  };
}

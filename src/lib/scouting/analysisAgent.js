// The Data Viewer's analysis agent: a Gemini model that answers questions about the event from our scouting data and
// outside FRC sources (The Blue Alliance, FIRST's FRC Events API, Match13, Statbotics). Shared by the page and the
// server.
//
// It is built but switched OFF. While ANALYSIS_AGENT_ENABLED is false the Agent tab still shows in the Data Viewer, but
// its page only says the agent isn't on yet (the question box is disabled), and /api/dataviewer-agent refuses every
// question (503), whatever keys the server has. Turning it on is deliberate: set this to true AND give the server DATA_VIEWER_AGENT_GEMINI_API_KEY.
export const ANALYSIS_AGENT_ENABLED = false;

/** The outside sources the agent may read, in the order the page lists them. */
export const AGENT_SOURCES = Object.freeze([
  { key: 'scouting', label: 'Our scouting', blurb: 'Every match and pit report, notes and the picklist' },
  { key: 'tba', label: 'The Blue Alliance', blurb: 'Schedules, results, rankings, OPRs, awards' },
  { key: 'first', label: 'FIRST FRC Events', blurb: "FIRST's official event, match and ranking data" },
  { key: 'match13', label: 'Match13', blurb: 'xP ratings and match forecasts' },
  { key: 'statbotics', label: 'Statbotics', blurb: 'EPA ratings and predictions' }
]);

/** Longest question the page sends, and how many earlier messages go with it (the server enforces the same). */
export const MAX_QUESTION_CHARS = 2000;
export const MAX_HISTORY_MESSAGES = 12;

/** The conversation as the API takes it: only user and agent text, trimmed, newest last. */
export function conversationForApi(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_QUESTION_CHARS) }));
}

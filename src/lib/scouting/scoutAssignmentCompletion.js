// Highest qualification match number accepted from a bare number.
const MAX_QUAL = 200;

export function canonicalScoutMatchSuffix(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;
  const suffix = raw
    .split('_')
    .pop()
    .trim()
    .replace(/[.,;:!]+$/, '');

  const canonical = suffix.match(/^(qm|ef|qf|sf|f)\s*(\d+)(?:m(\d+))?$/i);
  if (canonical) {
    return `${canonical[1].toLowerCase()}${Number(canonical[2])}${canonical[3] ? `m${Number(canonical[3])}` : ''}`;
  }
  // A bare number is a qualification match. No event has 200 quals, so a bigger number is a team
  // number typed into the wrong box, not a match.
  if (/^\d+$/.test(suffix)) return Number(suffix) >= 1 && Number(suffix) <= MAX_QUAL ? `qm${Number(suffix)}` : null;
  // "Q12" and "qm 45 - auto": a q or qm prefix followed by the number.
  const short = suffix.match(/^qm?\s*(\d+)\b/);
  if (short) return `qm${Number(short[1])}`;

  const qualification = suffix.match(/qual(?:ification|ifier|s)?\s*[-#:]?\s*(\d+)/i);
  if (qualification) return `qm${Number(qualification[1])}`;

  const playoffPatterns = [
    [/quarter\s*final\s*(\d+)\s*(?:match|m)\s*(\d+)/i, 'qf'],
    [/semi\s*final\s*(\d+)\s*(?:match|m)\s*(\d+)/i, 'sf'],
    [/octo\s*final\s*(\d+)\s*(?:match|m)\s*(\d+)/i, 'ef']
  ];
  for (const [pattern, level] of playoffPatterns) {
    const match = suffix.match(pattern);
    if (match) return `${level}${Number(match[1])}m${Number(match[2])}`;
  }
  const final = suffix.match(/(?:^|\s)finals?\s*[-#:]?\s*(\d+)/i);
  if (final) return `f1m${Number(final[1])}`;
  return null;
}

export function assignmentCompletionEvidence(rows, reports) {
  const evidence = new Map();
  for (const report of reports || []) {
    const suffix = canonicalScoutMatchSuffix(report?.match_key);
    const eventKey = String(report?.event_key || '')
      .trim()
      .toLowerCase();
    const teamKey = String(report?.team_key || '')
      .trim()
      .toLowerCase()
      .replace(/^frc/, '');
    if (!suffix || !eventKey || !teamKey) continue;
    const key = `${eventKey}|${suffix}|${teamKey}`;
    const timestamp = report.updated_at || report.created_at || null;
    if (!evidence.has(key) || String(timestamp || '') > String(evidence.get(key) || '')) evidence.set(key, timestamp);
  }

  return (rows || []).map((assignment) => {
    if (assignment?.completed_at) return assignment;
    const matchKey = String(assignment?.match_key || '')
      .trim()
      .toLowerCase();
    const eventKey = matchKey.includes('_') ? matchKey.split('_')[0] : '';
    const suffix = canonicalScoutMatchSuffix(matchKey);
    const teamKey = String(assignment?.team_key || '')
      .trim()
      .toLowerCase()
      .replace(/^frc/, '');
    const completedAt = evidence.get(`${eventKey}|${suffix}|${teamKey}`);
    return completedAt ? { ...assignment, completed_at: completedAt } : assignment;
  });
}

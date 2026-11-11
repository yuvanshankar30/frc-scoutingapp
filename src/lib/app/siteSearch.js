// What the site search (SiteSearch.svelte) finds: pages from the menu and teams at the active event. Kept free of
// Svelte so it can be tested on its own.

const MAX_RESULTS = 12;

const fold = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/** 0 when nothing matches, higher for better matches: a match at the start of a word beats one inside it. */
function score(haystack, needle) {
  const text = fold(haystack);
  if (!needle || !text) return 0;
  if (text === needle) return 100;
  if (text.startsWith(needle)) return 80;
  if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)) return 60;
  if (text.includes(needle)) return 40;
  return 0;
}

const teamNumberOf = (team) => Number(String(team?.team_number ?? team?.key ?? '').replace(/^frc/i, '')) || null;

/**
 * Results for a query: [{ id, kind: 'Page' | 'Team', label, detail, href }], best first. With no query, the pages in
 * menu order. A bare team number always offers that team, even when it isn't at the active event.
 */
export function searchSite(query, { pages = [], teams = [] } = {}) {
  const needle = fold(query).trim();
  const pageResult = (page) => ({
    id: `page:${page.href}`,
    kind: 'Page',
    label: page.label,
    detail: [page.group, page.blurb].filter(Boolean).join(' · '),
    href: page.href
  });
  if (!needle) return pages.slice(0, MAX_RESULTS).map(pageResult);

  const scored = [];
  for (const page of pages) {
    const best = Math.max(score(page.label, needle), score(page.blurb, needle) * 0.6, score(page.group, needle) * 0.5);
    if (best) scored.push({ score: best + 5, result: pageResult(page) });
  }
  const seen = new Set();
  for (const team of teams) {
    const number = teamNumberOf(team);
    if (!number) continue;
    const name = team.nickname || team.name || '';
    const best = Math.max(score(String(number), needle) + 10, score(name, needle));
    if (best <= 10) continue;
    seen.add(number);
    scored.push({
      score: best,
      result: {
        id: `team:${number}`,
        kind: 'Team',
        label: `${number}${name ? ` · ${name}` : ''}`,
        detail: [team.city, team.state_prov].filter(Boolean).join(', ') || 'Open in Team View',
        href: `/teamview?team=frc${number}`
      }
    });
  }
  const typed = /^(?:frc)?(\d{1,5})$/.exec(needle)?.[1];
  if (typed && !seen.has(Number(typed)))
    scored.push({
      score: 1,
      result: {
        id: `team:${Number(typed)}`,
        kind: 'Team',
        label: String(Number(typed)),
        detail: 'Open in Team View',
        href: `/teamview?team=frc${Number(typed)}`
      }
    });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.result);
}

// Filtering for the team picker popup: type part of a number or any word of a name.
// Teams whose number starts with what was typed come first, then name matches.
export function filterTeamOptions(options, query) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/#/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return options;
  const matches = options.filter((option) => {
    const number = String(option.number ?? '');
    const name = String(option.name ?? '').toLowerCase();
    return words.every((word) => number.startsWith(word) || name.includes(word));
  });
  const first = words[0];
  const byNumber = (option) => (String(option.number ?? '').startsWith(first) ? 0 : 1);
  return [...matches].sort((a, b) => byNumber(a) - byNumber(b) || Number(a.number) - Number(b.number));
}

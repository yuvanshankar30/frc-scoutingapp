// Search inside a dropdown's popup: every word has to appear in the option's text.
// Options that start with what was typed come first.
export function filterSelectOptions(options, query) {
  const words = String(query || '')
    .toLowerCase()
    .replace(/#/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return options;
  const text = (option) =>
    String(option.label ?? '')
      .toLowerCase()
      .replace(/#/g, '');
  const matches = options.filter((option) => words.every((word) => text(option).includes(word)));
  // Options that start with the search first, then ones containing the whole phrase
  // ("team 2" before a match on "team" and "2" separately), then the rest in their order.
  const phrase = words.join(' ');
  const rank = (option) => (text(option).trimStart().startsWith(phrase) ? 0 : text(option).includes(phrase) ? 1 : 2);
  return matches
    .map((option, order) => ({ option, order }))
    .sort((a, b) => rank(a.option) - rank(b.option) || a.order - b.order)
    .map((entry) => entry.option);
}

// A dropdown with this many options or fewer is short enough to read at a glance, so it
// gets no search box.
export const SEARCH_AFTER = 8;

import { viewportRect, viewportSize } from './zoom.js';
// Svelte action: gives an <input list="..."> the site's own suggestion popup instead of the
// browser's. It reads the same <datalist>, so the markup stays as it was; choosing a
// suggestion fills the input and fires a normal "input" event, so bind:value and on:input
// handlers see it exactly as if it had been typed.
export const SUGGEST_LIMIT = 40;

export function suggestionsFor(options, query) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const seen = new Set();
  const unique = options.filter((option) => (seen.has(option.value) ? false : seen.add(option.value)));
  if (!q) return unique.slice(0, SUGGEST_LIMIT);
  const text = (option) => `${option.value} ${option.text}`.toLowerCase();
  const hits = unique.filter((option) => text(option).includes(q));
  const starts = (option) => (option.value.toLowerCase().startsWith(q) ? 0 : 1);
  return hits
    .map((option, order) => ({ option, order }))
    .sort((a, b) => starts(a.option) - starts(b.option) || a.order - b.order)
    .map((entry) => entry.option)
    .filter((option) => !(hits.length === 1 && option.value.toLowerCase() === q))
    .slice(0, SUGGEST_LIMIT);
}

export function suggest(input) {
  const listId = input.getAttribute('list');
  if (!listId) return {};
  input.removeAttribute('list'); // stops the browser drawing its own popup
  input.setAttribute('autocomplete', 'off');

  let pop = null;
  let shown = [];
  let active = -1;

  const readOptions = () =>
    [...(document.getElementById(listId)?.options ?? [])]
      .map((option) => ({ value: option.value, text: (option.textContent || '').trim() }))
      .filter((option) => option.value);

  function place() {
    const rect = viewportRect(input);
    const viewportHeight = viewportSize().height;
    const below = viewportHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const flip = below < 160 && above > below;
    pop.style.left = `${rect.left}px`;
    pop.style.width = `${rect.width}px`;
    pop.style.maxHeight = `${Math.max(120, Math.min(260, flip ? above : below))}px`;
    pop.style.top = flip ? '' : `${rect.bottom + 4}px`;
    pop.style.bottom = flip ? `${viewportHeight - rect.top + 4}px` : '';
  }

  function close() {
    pop?.remove();
    pop = null;
    active = -1;
  }

  function choose(option) {
    input.value = option.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  }

  function paint() {
    if (!pop) return;
    [...pop.children].forEach((row, index) => {
      row.classList.toggle('active', index === active);
      if (index === active) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function render() {
    if (input.disabled || input.readOnly) return close();
    shown = suggestionsFor(readOptions(), input.value);
    if (!shown.length) return close();
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'suggest-pop';
      pop.setAttribute('role', 'listbox');
      // Keep the focus in the input while a suggestion is clicked.
      pop.addEventListener('mousedown', (event) => event.preventDefault());
      document.body.appendChild(pop);
    }
    pop.replaceChildren(
      ...shown.map((option, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.tabIndex = -1;
        row.setAttribute('role', 'option');
        const main = document.createElement('b');
        main.textContent = option.value;
        row.append(main);
        if (option.text && option.text !== option.value) {
          const note = document.createElement('span');
          note.textContent = option.text;
          row.append(note);
        }
        row.addEventListener('mousemove', () => {
          active = index;
          paint();
        });
        row.addEventListener('click', () => choose(option));
        return row;
      })
    );
    active = -1;
    place();
  }

  function onKey(event) {
    if (!pop) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      active = Math.min(shown.length - 1, active + 1);
      paint();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, active - 1);
      paint();
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(shown[active]);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') close();
  }

  const onScroll = (event) => {
    if (pop && !pop.contains(event.target)) close();
  };

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', close);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);

  return {
    destroy() {
      close();
      input.removeEventListener('focus', render);
      input.removeEventListener('input', render);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    }
  };
}

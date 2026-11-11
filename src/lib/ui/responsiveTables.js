// Phone layout for data tables, app-wide. On a phone, a table wider than the screen either
// scrolls sideways or squeezes its columns; instead each row becomes a card with every cell
// labelled by its column heading. This labels the cells (data-label from the <thead>) and marks the
// table with .rt-cards; the card layout itself is CSS in app.css, so desktop keeps the real table.
//
// Left alone: tables marked data-keep-table, tables without a header row, tables with fewer than
// three columns, and tables that already label their own cells (they have their own phone layout).

export const CARD_CLASS = 'rt-cards';

/** Column headings of the table's last header row, expanded by colspan so index = column. */
export function headerLabels(table) {
  const rows = table?.tHead?.rows || [];
  const row = rows[rows.length - 1];
  if (!row) return [];
  const labels = [];
  for (const cell of row.cells || []) {
    const text = String(cell.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    for (let span = 0; span < Math.max(1, Number(cell.colSpan) || 1); span += 1) labels.push(text);
  }
  return labels;
}

function bodyRows(table) {
  return [...(table?.tBodies || [])].flatMap((body) => [...(body.rows || [])]);
}

/** Whether a table should become cards on phones. */
export function shouldCard(table) {
  if (!table || table.hasAttribute?.('data-keep-table')) return false;
  if (table.classList?.contains(CARD_CLASS)) return true;
  if (headerLabels(table).length < 3) return false;
  // A table that already labels its own cells was given its own phone layout.
  return !bodyRows(table).some((row) => [...(row.cells || [])].some((cell) => cell.hasAttribute?.('data-label')));
}

/** Label every body cell with its column heading and mark the table. Returns true when it did. */
export function labelTable(table) {
  if (!shouldCard(table)) return false;
  const labels = headerLabels(table);
  for (const row of bodyRows(table)) {
    let column = 0;
    for (const cell of row.cells || []) {
      const label = labels[column] || '';
      if (label) cell.setAttribute('data-label', label);
      else cell.removeAttribute?.('data-label');
      column += Math.max(1, Number(cell.colSpan) || 1);
    }
  }
  table.classList.add(CARD_CLASS);
  return true;
}

/** Labels every table under root now and whenever rows are added (tables fill in as data loads). */
export function watchTables(root) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let queued = false;
  const run = () => {
    queued = false;
    for (const table of root.querySelectorAll('table')) labelTable(table);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  run();
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// A failed pit save (a 400 from the server, an expired sign-in, a missing auto description) only sets apiNote. On a
// phone the scout is at the bottom of a long form when they tap Submit, so a message drawn anywhere but next to the
// button is never seen: the button flips to Submitting… and back and nothing seems to happen.
const page = readFileSync('src/routes/pitscout/+page.svelte', 'utf8');

function submitRow(source) {
  const start = source.indexOf('<div class="submit-row">');
  const end = source.indexOf('</form>', start);
  return start === -1 || end === -1 ? '' : source.slice(start, end);
}

describe('pit scouting save message', () => {
  it('shows the save message inside the submit row, next to the Submit button', () => {
    const row = submitRow(page);
    expect(row).toContain('submit-btn');
    expect(row).toMatch(/\{#if apiNote\}\s*<div class="note submit-note"/);
  });

  it('does not show the same message a second time at the top of the open form', () => {
    expect(page).not.toMatch(/\{:else if apiNote\}\s*<div class="note">\{apiNote\}<\/div>/);
  });
});

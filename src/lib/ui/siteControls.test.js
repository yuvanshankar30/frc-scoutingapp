// Every dropdown, date and team chooser uses the site's own components (Select, DatePicker,
// TeamPicker), never the browser's or the OS's built-in pickers, so they look the same on every
// phone and computer and follow the theme. See CONTRIBUTING.md, "Dropdowns and pickers".
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src/routes', 'src/lib/components'];
// The components that wrap the native element. Nothing else may use one.
const ALLOWED = new Set(['src/lib/components/common/Select.svelte', 'src/lib/components/common/DatePicker.svelte']);

function svelteFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(full);
    return entry.name.endsWith('.svelte') ? [full] : [];
  });
}

// Markup only: comments and <script>/<style> blocks can mention "<select>" in prose.
const markup = (source) =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');

describe('site controls', () => {
  const files = ROOTS.flatMap(svelteFiles).filter((file) => !ALLOWED.has(file.split(path.sep).join('/')));

  it('never uses a native <select>; dropdowns use $lib/components/common/Select.svelte', () => {
    const offenders = files.filter((file) => /<select[\s>]/.test(markup(fs.readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('never uses a native date input; dates use $lib/components/common/DatePicker.svelte', () => {
    const offenders = files.filter((file) =>
      /<input[^>]*type=["'](date|datetime-local)["']/i.test(markup(fs.readFileSync(file, 'utf8')))
    );
    expect(offenders).toEqual([]);
  });

  it('never cuts text off with an ellipsis on phones: every ellipsis rule has a phone wrap override', () => {
    const offenders = files.filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return /text-overflow:\s*ellipsis/.test(source) && !source.includes('Phone: wrap, never cut text');
    });
    expect(offenders).toEqual([]);
  });

  it('never hard-codes a colour; colours come from the tokens in src/app.css', () => {
    // Comments, issue numbers ("#124") and fallbacks inside var(--token, …) don't count.
    const colours = (source) =>
      source
        .replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')
        .replace(/\/\/.*$/gm, '')
        .replace(/var\(--[\w-]+,[^()]*(\([^()]*\))?[^()]*\)/g, '')
        .match(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b(?<!#\d{3})|rgba?\(\s*\d/gi) || [];
    const offenders = ROOTS.flatMap(svelteFiles)
      .map((file) => [file.split(path.sep).join('/'), colours(fs.readFileSync(file, 'utf8'))])
      .filter(([, found]) => found.length)
      .map(([file, found]) => `${file}: ${found.join(' ')}`);
    expect(offenders).toEqual([]);
  });

  it('lets video embeds send the site origin, which YouTube requires (else "Error 153")', () => {
    // The site-wide Referrer-Policy is same-origin (hooks.server.js), which sends YouTube nothing.
    // Each video iframe sends just the origin, never the page path.
    const offenders = files.filter((file) => {
      const iframes = markup(fs.readFileSync(file, 'utf8')).match(/<iframe[\s\S]*?>/g) || [];
      return iframes.some((tag) => !/referrerpolicy="strict-origin-when-cross-origin"/.test(tag));
    });
    expect(offenders).toEqual([]);
  });
});

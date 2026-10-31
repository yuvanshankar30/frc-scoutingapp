import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// SvelteKit's production build refuses any export from a +server.js other than the HTTP handlers and route config
// (or names starting with _). Tests pass without the build, so check it here; helpers belong in $lib modules.
const ALLOWED = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|fallback|prerender|config|trailingSlash|entries|_\w*)$/;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name === '+server.js') files.push(full);
  }
})(path.resolve('src/routes'));

describe('route files', () => {
  it('export only what SvelteKit allows', () => {
    const bad = [];
    for (const file of files) {
      for (const m of readFileSync(file, 'utf8').matchAll(
        /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm
      )) {
        if (!ALLOWED.test(m[1])) bad.push(`${path.relative(process.cwd(), file)}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

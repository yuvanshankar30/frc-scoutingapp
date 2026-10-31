// Every call from a page to one of the app's own protected APIs sends the signed-in user's token
// (authFetch, or headers built from getAuthHeader). Without it the API answers 401 and the page hangs
// or shows nothing, as Picklist did. Public routes (/api/tba/*, /api/auth/*, the assistant's
// "configured" check) are the only exceptions.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROTECTED = /^\/(api|datascout|notescout|pitscout)\b/;
const PUBLIC = [/^\/api\/tba\//, /^\/api\/setup$/, /^\/api\/scouting-assistant$/];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(svelte|js)$/.test(entry.name) && !entry.name.endsWith('.test.js') ? [full] : [];
  });
}

// The argument list of each plain fetch(...) call, with nested brackets balanced.
function fetchCalls(source) {
  const calls = [];
  for (const match of source.matchAll(/(?<![\w.])fetch\(/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth && end < source.length) {
      const char = source[end++];
      if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char)) depth -= 1;
    }
    calls.push({ args: source.slice(match.index + match[0].length, end - 1), index: match.index });
  }
  return calls;
}

describe('API calls', () => {
  it("send the user's token to every protected API (use authFetch)", () => {
    const offenders = [];
    for (const file of ['src/routes', 'src/lib'].flatMap(sourceFiles)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const { args, index } of fetchCalls(source)) {
        const url = /^\s*[`'"]([^`'"?$]+)/.exec(args)?.[1];
        if (!url || !PROTECTED.test(url) || PUBLIC.some((pattern) => pattern.test(url))) continue;
        if (/headers/.test(args)) continue;
        offenders.push(`${file.split(path.sep).join('/')}:${source.slice(0, index).split('\n').length} ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

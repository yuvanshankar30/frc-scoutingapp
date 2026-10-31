// Every JS, Svelte and CSS file in src/ is Prettier-formatted, so `npm test` catches unformatted code
// the same way it catches a failing test (there is no CI). Fix a failure with `npm run format`.
// The config lives in prettier/; see CONTRIBUTING.md, "Formatting".
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as prettier from 'prettier';

const CONFIG = path.resolve('prettier/prettierrc.json');
const EXTENSIONS = new Set(['.js', '.svelte', '.css']);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

describe('formatting', () => {
  it('every file in src/ is formatted with Prettier (run `npm run format`)', async () => {
    const options = await prettier.resolveConfig(CONFIG, { config: CONFIG });
    const unformatted = [];
    for (const file of sourceFiles('src')) {
      const source = fs.readFileSync(file, 'utf8');
      if (!(await prettier.check(source, { ...options, filepath: file })))
        unformatted.push(file.split(path.sep).join('/'));
    }
    expect(unformatted).toEqual([]);
  }, 120_000);
});

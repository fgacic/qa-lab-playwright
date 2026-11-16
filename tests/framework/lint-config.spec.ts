// eslint.config.mjs counts a call to any listed `expect*` helper as an assertion (`playwright/expect-expect`). A stale name would
// let a test with no assertion pass the lint; an unlisted helper would make a test that does assert fail it. No browser: this reads files.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ASSERTION_HELPERS } from '../../scripts/lib/assertion-helpers.mjs';

const ROOT = join(__dirname, '..', '..');

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Names of the `expect…` functions and methods the code defines, as a declaration (`function`, `const`, `async`, a class method), never as a call or in a comment. */
function definedHelpers(): Set<string> {
  const declaration = /^\s*(?:export\s+)?(?:(?:async\s+)?function\s+|const\s+|(?:public\s+|private\s+)?async\s+|(?:public\s+|private\s+)?)(expect[A-Z]\w*)\s*(?:=|\(|<)/;
  const names = new Set<string>();
  for (const file of [...sourcesUnder('tests'), ...sourcesUnder('src'), ...sourcesUnder('fixtures')]) {
    for (const line of readFileSync(join(ROOT, file), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      const name = declaration.exec(line)?.[1];
      // A bare `expectX(...)` statement is a call; a declaration of a method or function ends its line with `{`.
      if (name && (/\b(?:function|const|async)\b/.test(line) || /\{\s*$/.test(line))) names.add(name);
    }
  }
  return names;
}

test.describe('the lint configuration', { tag: ['@framework'] }, () => {
  test('every listed assertion helper is defined somewhere in the code', () => {
    const defined = definedHelpers();
    expect(ASSERTION_HELPERS.filter((name) => !defined.has(name)), 'listed in scripts/lib/assertion-helpers.mjs but defined nowhere').toEqual([]);
  });

  test('every expect* helper the code defines is listed, so a test that only calls it counts as asserting', () => {
    const listed = new Set(ASSERTION_HELPERS);
    expect([...definedHelpers()].filter((name) => !listed.has(name)).sort(), 'defined, but missing from scripts/lib/assertion-helpers.mjs').toEqual([]);
  });

  test('the list has no duplicates', () => {
    expect(new Set(ASSERTION_HELPERS).size).toBe(ASSERTION_HELPERS.length);
  });
});

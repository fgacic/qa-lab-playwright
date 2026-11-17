// eslint.config.mjs counts a call to any listed `expect*` helper as an assertion (`playwright/expect-expect`). A stale name would
// let a test with no assertion pass the lint; an unlisted helper would make a test that does assert fail it. No browser: this reads files.
import { spawnSync } from 'node:child_process';
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

/** The lint messages the spec-only hazard rules (eslint.config.mjs) raise on each sample, from a node process that loads the config as ESLint does. */
function lintSamples(samples: string[]): string[][] {
  const run = spawnSync(process.execPath, [join(ROOT, 'tests', 'framework', 'probe', 'lint-samples.mjs')], { input: JSON.stringify(samples), encoding: 'utf8', timeout: 60_000 });
  expect(run.error, 'the lint run started').toBeUndefined();
  expect(run.status, run.stderr).toBe(0);
  return JSON.parse(run.stdout) as string[][];
}

const IN_PAGE = 'No code run in the page in a spec (evaluate, evaluateAll, evaluateHandle, $eval, $$eval, waitForFunction)';
const REFUSED: [code: string, message: string][] = [
  ['page.evaluate(() => 1)', IN_PAGE],
  ['this.page.evaluate(() => 1)', IN_PAGE],
  ['locator.evaluate((el) => el.id)', IN_PAGE],
  ['page.locator("a").evaluateAll((els) => els.length)', IN_PAGE],
  ['message.args()[0].evaluate((v) => v)', IN_PAGE],
  ['handle.evaluateHandle((v) => v)', IN_PAGE],
  ['page.$eval("a", (el) => el.id)', IN_PAGE],
  ['page.$$eval("a", (els) => els.length)', IN_PAGE],
  ['page.waitForFunction(() => true)', IN_PAGE],
  ['frame.waitForFunction(() => true)', IN_PAGE],
  ['const at = new Date();', 'No new Date() in a spec'],
  ['const t = performance.now();', 'No performance.now() in a spec'],
  ['const t = Date.now();', 'No Date.now in a spec'],
  ['const r = Math.random();', 'No Math.random in a spec'],
  ['await page.goto("http://example.test/a");', 'No hard-coded http(s)'],
  ['await page.goto("https://example.test/a");', 'No hard-coded http(s)'],
  ['const url = `http://example.test/${id}`;', 'No hard-coded http(s)'],
  ['test.describe.serial("a", () => {});', 'No serial describe'],
  ['test.describe.configure({ mode: "serial" });', 'No configure({ mode'],
];
const ALLOWED = [
  'const at = new Date("2026-01-02T03:04:05Z"); const n = new Date(0); await page.clock.install({ time: at });',
  'await expect(page.getByRole("button")).toBeVisible(); const t = await storedToken(page); await consoleArgsText(args);',
  'const status = await fetchStatus(page, "/api/brands");',
  'await page.goto("/products/" + id); const note = "see http docs"; const label = `${id}/https`;',
  'test.describe.parallel("a", () => {}); test.describe.configure({ mode: "parallel" }); test.describe.configure({ retries: 2 });',
];

test.describe('the hazard rules for specs', { tag: ['@framework'] }, () => {
  let refused: string[][];
  let allowed: string[][];
  test.beforeAll(() => {
    [refused, allowed] = [lintSamples(REFUSED.map(([code]) => code)), lintSamples(ALLOWED)];
  });

  REFUSED.forEach(([code, message], i) => {
    test(`${code} is refused`, () => {
      expect(refused[i]).toEqual([message]);
    });
  });

  test('a fixed date and the helpers that are allowed are not refused', () => {
    expect(allowed).toEqual(ALLOWED.map(() => []));
  });
});

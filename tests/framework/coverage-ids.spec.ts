// Every defect id the code pins appears in docs/COVERAGE.md, and every id the document lists is pinned in the
// code. The two are written by hand, so without this a pin can be added with no row, or a row left behind
// after its pin was deleted. No browser: this reads files.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { KNOWN } from '@support/i18n-baseline';
import { KNOWN_VIOLATIONS } from '@support/a11y-baseline';

const ID = /(?:BUG|A11Y|ADM|AX|I18N|SEC|PERF)-\d+/;
const ROOT = join(__dirname, '..', '..');

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Ids passed to `knownBug(...)`, given as a table row's `id:` or as a baseline `pin:`, in specs and baselines. */
function pinnedInCode(): Set<string> {
  const declaration = new RegExp(`(?:knownBug\\(\\s*|\\bid:\\s*|\\bpin:\\s*)['"\`](${ID.source})['"\`]`, 'g');
  const ids = new Set<string>();
  for (const file of [...sourcesUnder('tests'), ...sourcesUnder('src'), ...sourcesUnder('fixtures')]) {
    for (const [, id] of readFileSync(join(ROOT, file), 'utf8').matchAll(declaration)) ids.add(id);
  }
  return ids;
}

/** The first column of every table row of COVERAGE.md that is a defect id. */
function listedInCoverage(): Set<string> {
  const row = new RegExp(`^\\|\\s*(${ID.source})\\s*\\|`, 'gm');
  return new Set([...readFileSync(join(ROOT, 'docs', 'COVERAGE.md'), 'utf8').matchAll(row)].map(([, id]) => id));
}

test.describe('defect ids', { tag: ['@framework'] }, () => {
  test('the baselines pin ids of their own, and the scan finds the declarations at all', () => {
    const code = pinnedInCode();
    expect(KNOWN.length, 'the i18n baseline is empty').toBeGreaterThan(0);
    expect(KNOWN_VIOLATIONS.length, 'the a11y baseline is empty').toBeGreaterThan(0);
    for (const { id } of [...KNOWN, ...KNOWN_VIOLATIONS]) expect(code.has(id), `${id} is in a baseline but the scan did not see it`).toBe(true);
    expect(code.size, 'the scan found suspiciously few ids').toBeGreaterThan(50);
  });

  test('every id pinned in the code has a row in docs/COVERAGE.md', () => {
    const listed = listedInCoverage();
    const missing = [...pinnedInCode()].filter((id) => !listed.has(id)).sort();
    expect(missing, 'pinned in the code, with no row in docs/COVERAGE.md').toEqual([]);
  });

  test('every id listed in docs/COVERAGE.md is pinned in the code', () => {
    const code = pinnedInCode();
    const orphans = [...listedInCoverage()].filter((id) => !code.has(id)).sort();
    expect(orphans, 'listed in docs/COVERAGE.md, but no test pins it').toEqual([]);
  });
});

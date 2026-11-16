// scripts/test-all.mjs (`npm test`) runs the suite as several passes in separate processes. A pass in which the extra arguments select
// nothing is skipped, not failed, and the summary names every pass. No browser: the filter selects no test, so no pass starts one.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = join(__dirname, '..', '..');

test.describe('the test-all runner', { tag: ['@framework', '@self-hosted'] }, () => {
  test('a pass in which the arguments select no test is reported as skipped, and the run exits 0', () => {
    const output = mkdtempSync(join(tmpdir(), 'test-all-spec-'));
    try {
      // --output keeps the nested passes from emptying this run's own test-results directory.
      const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'test-all.mjs'), '--grep', '@no-test-carries-this-tag', `--output=${output}`], { cwd: ROOT, encoding: 'utf8', timeout: 150_000 });
      expect(run.error, 'test-all started').toBeUndefined();
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
      const summary = run.stdout.slice(run.stdout.lastIndexOf('\n\n'));
      for (const pass of ['browsers', 'framework', 'perf', 'sessions']) expect(summary, `the summary lists the ${pass} pass as skipped`).toMatch(new RegExp(`skipped  ${pass}`));
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});

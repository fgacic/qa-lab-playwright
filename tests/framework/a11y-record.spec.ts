// A11Y_RECORD rebuilds the accessibility baseline from what a scan finds, asserting nothing: on CI that would turn every violation into
// "known". tests/a11y/pages.a11y.spec.ts refuses it there; this runs one real scan (the home page's, by its title; the phone-width one matches too and refuses alike) under CI=1 and A11Y_RECORD set and reads the refusal.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = join(__dirname, '..', '..');

test.describe('recording the accessibility baseline', { tag: ['@framework', '@self-hosted'] }, () => {
  test('is refused when CI is set, before anything is written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a11y-record-'));
    try {
      const record = join(dir, 'findings.jsonl');
      const run = spawnSync('npx', ['playwright', 'test', 'tests/a11y/pages.a11y.spec.ts', '--project=chromium', '--grep', 'no new violations on the home page', '--retries=0', '--max-failures=0', '--reporter=line', `--output=${join(dir, 'artifacts')}`], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, CI: '1', A11Y_RECORD: record },
      });
      expect(run.error, 'the nested run started').toBeUndefined();
      expect(run.status, 'the scan fails instead of recording').not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain('A11Y_RECORD is for rebuilding the baseline locally; it refuses to run when CI is set.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

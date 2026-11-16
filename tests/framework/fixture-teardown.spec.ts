// The fixtures that fail a test AFTER its body: the write guard's `blockedWrites` assertion (fixtures/mocks.ts) and the console
// guard (fixtures/console-guard.ts). `test.fail` would accept any failure, so these run real probe tests in a nested Playwright
// process (tests/framework/probe) and read from its JSON report which test failed and with what message.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

interface Outcome {
  status: string;
  messages: string;
}

/** Runs the probe specs once and maps each test title to what happened to it. */
function runProbes(): Record<string, Outcome> {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'));
  try {
    const out = join(dir, 'report.json');
    const run = spawnSync('npx', ['playwright', 'test', '--config=tests/framework/probe/playwright.probe.config.ts', `--output=${join(dir, 'artifacts')}`], {
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out },
    });
    expect(run.error, 'the nested run started').toBeUndefined();
    interface Spec { title: string; tests: { results: { status: string; errors: { message: string }[] }[] }[] }
    const report = JSON.parse(readFileSync(out, 'utf8')) as { suites: { specs: Spec[] }[] };
    const outcomes: Record<string, Outcome> = {};
    for (const suite of report.suites) {
      for (const spec of suite.specs) {
        const result = spec.tests[0].results.at(-1)!;
        // eslint-disable-next-line no-control-regex -- strips ANSI colour
        outcomes[spec.title] = { status: result.status, messages: result.errors.map((e) => e.message.replace(/\u001b\[[0-9;]*m/g, '')).join('\n') };
      }
    }
    return outcomes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('fixture teardown guards', { tag: ['@framework', '@self-hosted'] }, () => {
  let outcomes: Record<string, Outcome>;
  test.beforeAll(() => {
    outcomes = runProbes();
  });

  test('a write no mock answered fails the test that sent it, at teardown, naming the write', () => {
    const outcome = outcomes['probe: an unmocked write'];
    expect(outcome.status).toBe('failed');
    expect(outcome.messages).toContain('writes that reached no mock (refused, never sent)');
    expect(outcome.messages).toContain('DELETE /brands/1');
  });

  test('a mocked write leaves nothing to fail at teardown', () => {
    expect(outcomes['probe: a mocked write'].status).toBe('passed');
  });

  test('an error the app logs fails the test at teardown, unless the test allowed that very error', () => {
    expect(outcomes['probe: an error the page logs'].status).toBe('failed');
    expect(outcomes['probe: an error the page logs'].messages).toContain('[console] probe: the app logged this');
    expect(outcomes['probe: an error the page logs and the test allows'].status).toBe('passed');
  });

  test('an error the page throws uncaught fails the test too', () => {
    expect(outcomes['probe: an uncaught error in the page'].status).toBe('failed');
    expect(outcomes['probe: an uncaught error in the page'].messages).toContain('[pageerror]');
    expect(outcomes['probe: an uncaught error in the page'].messages).toContain('probe: uncaught');
  });
});

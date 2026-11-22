// The fixtures that fail a test AFTER its body: the write guard's `blockedWrites` assertion (fixtures/mocks.ts) and the console
// guard (fixtures/console-guard.ts). `test.fail` would accept any failure, so these run real probe tests in a nested Playwright
// process (tests/framework/probe) and read from its JSON report which test failed and with what message.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = join(__dirname, '..', '..');

interface Outcome {
  status: string;
  messages: string;
}

/** Runs the probe specs once and maps each test title to what happened to it. */
async function runProbes(): Promise<Record<string, Outcome>> {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'));
  try {
    const out = join(dir, 'report.json');
    const run = spawnSync('npx', ['playwright', 'test', '--config=tests/framework/probe/playwright.probe.config.ts', `--output=${join(dir, 'artifacts')}`], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 100_000, // a hung nested run must fail this spec, not hold the suite
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out },
    });
    expect(run.error, 'the nested run started').toBeUndefined();
    // No report means the nested run never got going (a config that failed to load): its stderr says why.
    if (!existsSync(out)) {
      await test.info().attach('nested-run-stderr.txt', { body: run.stderr, contentType: 'text/plain' });
      throw new Error(`the nested run wrote no report (exit ${run.status}); its stderr is attached`);
    }
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
  // One nested run feeds every test below: normally once per worker; a retry after a failure restarts the worker and repeats it (up to 100 s), which is the price of one shared nested run.
  test.describe.configure({ mode: 'default' });
  let outcomes: Record<string, Outcome>;
  /**
   * What happened to the probe of this title (tests/framework/probe/guarded-writes.probe.ts); a renamed probe is named here, not a TypeError on `undefined`.
   * The titles are strings on both sides, not shared constants: Playwright refuses to import a file that declares tests into another one.
   */
  const outcomeOf = (title: string): Outcome => {
    const outcome = outcomes[title];
    if (!outcome) throw new Error(`no probe titled "${title}" ran; the nested run reported: ${Object.keys(outcomes).join(' | ')}`);
    return outcome;
  };
  test.beforeAll(async () => {
    test.setTimeout(120_000); // the nested run starts a second Playwright: longer than a test's own budget
    outcomes = await runProbes();
  });

  test('a write no mock answered fails the test that sent it, at teardown, naming the write', () => {
    const outcome = outcomeOf('probe: an unmocked write');
    expect(outcome.status).toBe('failed');
    expect(outcome.messages).toContain('writes that reached no mock (refused, never sent)');
    expect(outcome.messages).toContain('DELETE /brands/1');
  });

  test('a mocked write leaves nothing to fail at teardown', () => {
    expect(outcomeOf('probe: a mocked write').status).toBe('passed');
  });

  test('an error the app logs fails the test at teardown, unless the test allowed that very error', () => {
    const logged = outcomeOf('probe: an error the page logs');
    expect(logged.status).toBe('failed');
    expect(logged.messages).toContain('[console] probe: the app logged this');
    expect(outcomeOf('probe: an error the page logs and the test allows').status).toBe('passed');
  });

  test('an error the page throws uncaught fails the test too', () => {
    const uncaught = outcomeOf('probe: an uncaught error in the page');
    expect(uncaught.status).toBe('failed');
    expect(uncaught.messages).toContain('[pageerror]');
    expect(uncaught.messages).toContain('probe: uncaught');
  });

  test('a failure of the mock layer itself (a delay predicate that threw) fails the test at teardown, naming the predicate', () => {
    const outcome = outcomeOf('probe: a delay predicate that throws');
    expect(outcome.status).toBe('failed');
    expect(outcome.messages).toContain('failures of the mock layer itself');
    expect(outcome.messages).toContain('the predicate broke');
  });

  test('a pinned defect is allowed suite-wide only on its own page: BUG-47 on the profile page passes, the same error elsewhere fails', () => {
    expect(outcomeOf('probe: a TypeError reading value on the profile page, the pinned defect (BUG-47)').status).toBe('passed');
    const elsewhere = outcomeOf('probe: the same TypeError on another page');
    expect(elsewhere.status).toBe('failed');
    expect(elsewhere.messages).toContain('[pageerror]');
    expect(elsewhere.messages).toContain("reading 'value'");
  });

  test('the browser line for a failed API request is allowed when a mock of the test answered it, and fails the test when nothing did', () => {
    expect(outcomeOf('probe: a 500 of the API that a mock of the test answered').status).toBe('passed');
    const unmocked = outcomeOf('probe: a 500 of the API that no mock of the test answered');
    expect(unmocked.status).toBe('failed');
    expect(unmocked.messages).toContain('Failed to load resource');
    expect(unmocked.messages).toContain('/probe-500');
  });

  test('an "Unauthorized" log is allowed only with the 401 of GET /users/me behind it', () => {
    expect(outcomeOf('probe: an Unauthorized log with the 401 of GET /users/me behind it').status).toBe('passed');
    const bare = outcomeOf('probe: an Unauthorized log with no 401 behind it');
    expect(bare.status).toBe('failed');
    expect(bare.messages).toContain('Unauthorized');
  });
});

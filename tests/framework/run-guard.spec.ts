// The run guards (src/support/run-guard.ts, run-guard-reporter.ts) and the failure bookkeeping around them: the perf-alone rule,
// the bot-challenge skip ratio, the knownBug tag requirement and the step-title redaction. No browser: pure functions.
import type { FullResult } from '@playwright/test/reporter';
import { expect, test } from '@playwright/test';
import { BOT_CHALLENGE_REASON } from '@support/bot-challenge';
import RunGuardReporter from '@support/run-guard-reporter';
import { knownBug } from '@support/known-bug';
import { overridesReporter, perfAloneViolation, perfAloneViolationFor, selectedProjects, skipRatioViolation } from '@support/run-guard';
import { format, REDACTED } from '@support/step';

/** Not shaped like a defect id, so the id/docs cross-check (coverage-ids.spec.ts) does not take it for a pin. */
const UNTAGGED_PIN = 'not-a-real-id';

test.describe('the run guards', { tag: ['@framework'] }, () => {
  test('perf must run alone: a mix is refused, perf by itself or without perf is not', () => {
    expect(perfAloneViolation(['perf', 'perf'])).toBeUndefined();
    expect(perfAloneViolation(['chromium', 'firefox'])).toBeUndefined();
    expect(perfAloneViolation([])).toBeUndefined();
    expect(perfAloneViolation(['perf', 'chromium', 'webkit', 'perf'])).toMatch(/also schedules chromium, webkit/);
  });

  test('the projects of a command line are read from --project in both spellings, or default to every configured one', () => {
    const configured = ['chromium', 'perf'];
    expect(selectedProjects(['test', '--project=perf'], configured)).toEqual(['perf']);
    expect(selectedProjects(['test', '--project', 'perf', '--project=chromium'], configured)).toEqual(['perf', 'chromium']);
    expect(selectedProjects(['test', '--project=perf,chromium'], configured)).toEqual(['perf', 'chromium']);
    expect(selectedProjects(['test', '--grep', 'x'], configured), 'no flag: everything configured is scheduled').toEqual(configured);
  });

  test('--project is read as Playwright reads it: any case, wildcards, several names after one flag', () => {
    const configured = ['chromium', 'firefox', 'perf', 'framework'];
    expect(selectedProjects(['test', '--project=PERF'], configured), 'case').toEqual(['perf']);
    expect(selectedProjects(['test', '--project=per*'], configured), 'a wildcard').toEqual(['perf']);
    expect(selectedProjects(['test', '--project=?irefox'], configured), 'a single-character wildcard').toEqual(['firefox']);
    expect(selectedProjects(['test', '--project', 'chromium', 'perf'], configured), 'the option is variadic').toEqual(['chromium', 'perf']);
    expect(selectedProjects(['test', '--project=*'], configured), 'every project').toEqual(configured);
    expect(selectedProjects(['test', '--project=chrom'], configured), 'a name is matched whole, not as a prefix').toEqual([]);
    expect(selectedProjects(['test', '--project=chromium', '--project=Chromium'], configured), 'no duplicates').toEqual(['chromium']);
  });

  test('the perf rule of a --reporter run: refused when perf is selected next to others, however it is spelled, and not otherwise', () => {
    const configured = ['chromium', 'firefox', 'perf', 'framework'];
    const run = (...args: string[]) => perfAloneViolationFor(['node', 'cli.js', 'test', ...args], configured);
    expect(run('--reporter=json'), 'no filter: every project is scheduled, perf included').toMatch(/also schedules chromium, firefox, framework/);
    expect(run('--reporter=json', '--project=perf')).toBeUndefined();
    expect(run('--reporter=json', '--project=PERF', '--project=chromium'), 'another case').toMatch(/also schedules chromium/);
    expect(run('--reporter=json', '--project=per*', '--project=chrom*'), 'globs').toMatch(/also schedules chromium/);
    expect(run('--reporter=json', '--project', 'perf', 'framework'), 'a variadic list').toMatch(/also schedules framework/);
    expect(run('--reporter=json', '--project=chromium'), 'perf is not selected').toBeUndefined();
    expect(run('--reporter=json', 'tests/framework/run-guard.spec.ts'), 'a file filter that does not name perf').toBeUndefined();
    expect(run('--reporter=json', '--grep', '@smoke'), 'a grep that does not name perf').toBeUndefined();
    expect(run('--reporter=json', '--workers', '2', '--retries=0', 'tests/framework'), 'value flags are not filters').toBeUndefined();
    expect(run('--reporter=json', 'tests/performance'), 'perf named in a filter, no --project: refused as inexact').toMatch(/Pass --project=perf/);
    expect(run('--reporter=json', '-g', '@perf')).toMatch(/Pass --project=perf/);
    expect(perfAloneViolationFor(['node', 'cli.js', 'test', '--reporter=json'], ['chromium', 'firefox']), 'no perf project configured').toBeUndefined();
    expect(perfAloneViolationFor(['/opt/perf-lab/node', '/opt/perf-lab/cli.js', 'test', '--reporter=json', '--grep', '@smoke'], configured), 'perf in the path of the binary or the cli is not perf in the filter').toBeUndefined();
  });

  test('a --reporter flag is recognised, because it replaces the run-guard reporter', () => {
    expect(overridesReporter(['test', '--reporter=json'])).toBe(true);
    expect(overridesReporter(['test', '--reporter', 'line'])).toBe(true);
    expect(overridesReporter(['test', '--project=perf'])).toBe(false);
  });

  test('the skip ratio fails a run above 20 percent, not at it, and never an empty one', () => {
    expect(skipRatioViolation(0, 0)).toBeUndefined();
    expect(skipRatioViolation(2, 10), 'exactly the limit passes').toBeUndefined();
    expect(skipRatioViolation(3, 10)).toMatch(/3 of 10 tests were skipped because Cloudflare challenged the run/);
    expect(skipRatioViolation(10, 10)).toBeDefined();
  });

  /** A minimal suite: what the reporter reads of it. */
  const suiteOf = (tests: { project: string; skipped?: boolean; challenged?: boolean }[]) => ({
    allTests: () =>
      tests.map(({ project, skipped = false, challenged = false }) => ({
        parent: { project: () => ({ name: project }) },
        outcome: () => (skipped ? 'skipped' : 'expected'),
        annotations: challenged ? [{ type: 'skip', description: BOT_CHALLENGE_REASON }] : [],
      })),
  });
  const endOf = async (tests: Parameters<typeof suiteOf>[0]): Promise<FullResult | undefined> => {
    const reporter = new RunGuardReporter();
    reporter.onBegin({} as never, suiteOf(tests) as never);
    return (await reporter.onEnd()) as FullResult | undefined;
  };

  test('the reporter fails a run in which more than the allowed share was challenged, and passes one below it', async () => {
    const challenged = { project: 'chromium', skipped: true, challenged: true };
    expect(await endOf([challenged, challenged, { project: 'chromium' }])).toEqual({ status: 'failed' });
    expect(await endOf([challenged, { project: 'chromium' }, { project: 'chromium' }, { project: 'chromium' }, { project: 'chromium' }, { project: 'chromium' }])).toBeUndefined();
  });

  test('the reporter does not count a skip for another reason, nor a setup project, in the ratio', async () => {
    const otherSkip = { project: 'chromium', skipped: true };
    const setupChallenged = { project: 'account-setup', skipped: true, challenged: true };
    expect(await endOf([otherSkip, otherSkip, { project: 'chromium' }]), 'a skip that is not the challenge').toBeUndefined();
    expect(await endOf([setupChallenged, setupChallenged, { project: 'chromium' }, { project: 'chromium' }]), 'setup tests stay out').toBeUndefined();
  });

  test('knownBug refuses a test that lacks the bug tag: verify-bugs would never check it', () => {
    // The tag is read from the running test, which here has only @framework.
    expect(() => knownBug(UNTAGGED_PIN, 'a defect')).toThrow(/needs the @bug tag/);
  });
});

test.describe('step titles', { tag: ['@framework'] }, () => {
  test('values under a key that looks like a secret are redacted, at any depth, and others are kept', () => {
    expect(format({ email: 'a@b.c', password: 'hunter2', nested: { accessToken: 'abc', client_secret: 'x', note: 'ok' } })).toBe(
      `{"email":"a@b.c","password":"${REDACTED}","nested":{"accessToken":"${REDACTED}","client_secret":"${REDACTED}","note":"ok"}}`,
    );
    expect(format('plain')).toBe('plain');
    expect(format(['a', 'b'])).toBe('a, b');
    expect(format(undefined)).toBe('');
    expect(format('hunter2', 'password'), 'a {0.password} placeholder').toBe(REDACTED);
    expect(format('Pliers', 'name')).toBe('Pliers');
  });
});

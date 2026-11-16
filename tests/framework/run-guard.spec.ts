// The run guards (src/support/run-guard.ts, run-guard-reporter.ts) and the failure bookkeeping around them: the perf-alone rule,
// the bot-challenge skip ratio, the knownBug tag requirement and the step-title redaction. No browser: pure functions.
import type { FullResult } from '@playwright/test/reporter';
import { expect, test } from '@playwright/test';
import { BOT_CHALLENGE_REASON } from '@support/bot-challenge';
import { describeError, isApiResourceFailure, PINNED_DEFECT_LOGS, SUITE_WIDE_ALLOWANCES, unexpectedErrors } from '@support/console-guard';
import RunGuardReporter from '@support/run-guard-reporter';
import { httpUrl } from '@support/urls';
import { knownBug } from '@support/known-bug';
import { overridesReporter, perfAloneViolation, selectedProjects, skipRatioViolation } from '@support/run-guard';
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

test.describe('the console guard', { tag: ['@framework'] }, () => {
  const logged = (text: string, url?: string) => ({ kind: 'console' as const, text, url });

  test('an error is unexpected unless an allowance matches it', () => {
    const errors = [logged('Uncaught TypeError: x is undefined'), { kind: 'pageerror' as const, text: 'ReferenceError: y' }, logged('third party noise')];
    expect(unexpectedErrors(errors, [])).toHaveLength(3);
    expect(unexpectedErrors(errors, [{ pattern: /third party/, reason: 'test' }]).map((e) => e.text)).toEqual(['Uncaught TypeError: x is undefined', 'ReferenceError: y']);
  });

  test("the browser's own line for a failed API request is not an error of the page, but a broken asset is", () => {
    const apiFailure = logged('Failed to load resource: the server responded with a status of 500 ()', httpUrl('localhost', '/api/products'));
    const assetFailure = logged('Failed to load resource: net::ERR_FAILED', httpUrl('localhost', '/assets/logo.png'));
    expect(isApiResourceFailure(apiFailure)).toBe(true);
    expect(isApiResourceFailure(assetFailure)).toBe(false);
    expect(unexpectedErrors([apiFailure, assetFailure], [])).toEqual([assetFailure]);
  });

  test('an allowance is matched against the error text and against the arguments the page passed, so it holds in every engine', () => {
    const unauthorized = { ...logged('ERROR JSHandle@object'), args: 'ERROR {"message":"Unauthorized"}' };
    const chromium = logged('ERROR {message: Unauthorized}');
    const unknownProduct = { ...logged('ERROR yi'), args: `ERROR {"status":404,"statusText":"Not Found","url":"${httpUrl('localhost', '/api/products/0000')}","name":"HttpErrorResponse"}` };
    const cancelled = logged('ERROR XMLHttpRequestProgressEvent');
    expect(unexpectedErrors([unauthorized, chromium, unknownProduct, cancelled], SUITE_WIDE_ALLOWANCES)).toEqual([]);
  });

  test('the suite-wide allowances are narrow: a single-word ERROR line or an error on another route is still unexpected', () => {
    const anyError = { ...logged('ERROR yi'), args: 'ERROR {"status":500,"url":"/api/brands","name":"HttpErrorResponse"}' };
    const orderError = { ...logged('ERROR JSHandle@object'), args: 'ERROR {"message":"Something went wrong"}' };
    expect(unexpectedErrors([anyError, orderError], SUITE_WIDE_ALLOWANCES)).toEqual([anyError, orderError]);
  });

  test('every pinned defect an allowance covers matches the line of each engine and names its pin', () => {
    const lines: Record<string, string[]> = {
      'BUG-37': ['[angularx-qrcode] Field `qrdata` is empty, set \'allowEmptyString="true"\' to overwrite this behaviour.'],
      'BUG-38': ["TypeError: Cannot read properties of null (reading 'cart_items')", "TypeError: null is not an object (evaluating 'e.cart_items')", 'TypeError: can\'t access property "cart_items", e is null'],
      'SEC-13': ["TypeError: Cannot read properties of undefined (reading 'name')", "TypeError: undefined is not an object (evaluating 'this.categories[0].name')", 'TypeError: this.categories[0] is undefined'],
      'BUG-02': ["NG04002: 'this/route/does/not/exist'"],
      'BUG-47': ["TypeError: Cannot read properties of undefined (reading 'value')", "TypeError: undefined is not an object (evaluating 'e.password.value')", 'TypeError: can\'t access property "value", e is undefined'],
      'ADM-21': ['NG01002: Must supply a value for form control with name: enabled'],
    };
    expect(PINNED_DEFECT_LOGS.map(({ id }) => id).sort()).toEqual(Object.keys(lines).sort());
    for (const { id, pattern } of PINNED_DEFECT_LOGS) for (const line of lines[id]) expect(pattern.test(line), `${id} should match "${line}"`).toBe(true);
  });

  test('an error is described on one line, with its URL', () => {
    expect(describeError(logged('first line\nsecond', httpUrl('x', '/y')))).toBe(`[console] first line (${httpUrl('x', '/y')})`);
  });
});

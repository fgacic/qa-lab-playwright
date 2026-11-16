// The run guards (src/support/run-guard.ts, run-guard-reporter.ts) and the failure bookkeeping around them: the perf-alone rule,
// the bot-challenge skip ratio, the knownBug tag requirement and the step-title redaction. No browser: pure functions.
import type { FullResult } from '@playwright/test/reporter';
import { expect, test } from '@playwright/test';
import { BOT_CHALLENGE_REASON } from '@support/bot-challenge';
import { describeError, isApiResourceFailure, PINNED_DEFECT_LOGS, SUITE_WIDE_ALLOWANCES, unexpectedErrors } from '@support/console-guard';
import RunGuardReporter from '@support/run-guard-reporter';
import { API_URL } from '@support/env';
import { httpUrl } from '@support/urls';
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

  const API = (path: string) => `${API_URL}${path}`;
  const failedResource = (status: number, path: string) => logged(`Failed to load resource: the server responded with a status of ${status} ()`, API(path));
  const unauthorizedLog = { ...logged('ERROR JSHandle@object'), args: 'ERROR {"message":"Unauthorized"}' };

  test('the browser line for a failed API request is allowed only for a status the suite expects or an answer a mock gave', () => {
    const assetFailure = logged('Failed to load resource: net::ERR_FAILED', httpUrl('localhost', '/assets/logo.png'));
    expect(isApiResourceFailure(failedResource(401, '/users/me'))).toBe(true);
    expect(isApiResourceFailure(failedResource(404, '/products/0000'))).toBe(true);
    expect(isApiResourceFailure(failedResource(422, '/carts/1/product/quantity')), 'the shop refusing invalid input').toBe(true);
    expect(isApiResourceFailure(failedResource(409, '/brands')), 'the shop refusing a conflicting one').toBe(true);
    expect(isApiResourceFailure(assetFailure), 'a broken asset').toBe(false);
    expect(isApiResourceFailure(failedResource(500, '/products')), 'a 5xx nobody mocked').toBe(false);
    expect(isApiResourceFailure(logged('Failed to load resource: net::ERR_CONNECTION_REFUSED', API('/products'))), 'a refused connection').toBe(false);
    expect(isApiResourceFailure(failedResource(403, '/users/me')), 'a status that is not expected').toBe(false);
    expect(unexpectedErrors([failedResource(500, '/brands'), assetFailure], [])).toEqual([failedResource(500, '/brands'), assetFailure]);
  });

  test('a failure a mock of the test answered is allowed, for that path and that status only', () => {
    const mocked = [{ pathname: '/products', outcome: 500 as const }, { pathname: '/brands', outcome: 'aborted' as const }];
    expect(isApiResourceFailure(failedResource(500, '/products'), mocked)).toBe(true);
    expect(isApiResourceFailure(failedResource(502, '/products'), mocked), 'another status').toBe(false);
    expect(isApiResourceFailure(failedResource(500, '/categories'), mocked), 'another path').toBe(false);
    expect(isApiResourceFailure(logged('Failed to load resource: net::ERR_FAILED', API('/brands')), mocked), 'an aborted request').toBe(true);
    expect(isApiResourceFailure(logged('Failed to load resource: net::ERR_FAILED', API('/products')), mocked), 'an abort nobody mocked on that path').toBe(false);
  });

  test('an allowance is matched against the error text and against the arguments the page passed, so it holds in every engine', () => {
    const me401 = failedResource(401, '/users/me');
    const chromium = logged('ERROR {message: Unauthorized}');
    const unknownProduct = { ...logged('ERROR yi'), route: '/product/0000', args: `ERROR {"status":404,"statusText":"Not Found","url":"${API('/products/0000')}","name":"HttpErrorResponse"}` };
    const cancelled = logged('ERROR XMLHttpRequestProgressEvent');
    expect(unexpectedErrors([me401, failedResource(401, '/users/me'), unauthorizedLog, chromium, unknownProduct, cancelled], SUITE_WIDE_ALLOWANCES, [], [{ method: 'GET', pathname: '/users/me', status: 401 }])).toEqual([]);
  });

  test('an "Unauthorized" log needs a 401 of GET /users/me the browser received, in any engine, and as many logs as subscribers echo it', () => {
    const answer = (method: string, pathname: string, status: number) => ({ method, pathname, status });
    const me401 = answer('GET', '/users/me', 401);
    expect(unexpectedErrors([unauthorizedLog], SUITE_WIDE_ALLOWANCES), 'no request behind it').toEqual([unauthorizedLog]);
    expect(unexpectedErrors([unauthorizedLog], SUITE_WIDE_ALLOWANCES, [], [answer('GET', '/invoices', 401)]), 'the 401 of another endpoint').toEqual([unauthorizedLog]);
    expect(unexpectedErrors([unauthorizedLog], SUITE_WIDE_ALLOWANCES, [], [answer('GET', '/users/me', 200)]), 'a /users/me that answered').toEqual([unauthorizedLog]);
    expect(unexpectedErrors([unauthorizedLog], SUITE_WIDE_ALLOWANCES, [], [answer('POST', '/users/me', 401)]), 'another method').toEqual([unauthorizedLog]);
    expect(unexpectedErrors([unauthorizedLog], SUITE_WIDE_ALLOWANCES, [], [me401]), 'with no console line of the browser for the 401, as in Firefox and WebKit').toEqual([]);
    expect(unexpectedErrors([unauthorizedLog, { ...unauthorizedLog }, { ...unauthorizedLog }], SUITE_WIDE_ALLOWANCES, [], [me401]), 'one shared request, several subscribers logging it').toEqual([]);
  });

  test('the suite-wide allowances are narrow: a single-word ERROR line or an error on another route is still unexpected', () => {
    const anyError = { ...logged('ERROR yi'), args: 'ERROR {"status":500,"url":"/api/brands","name":"HttpErrorResponse"}' };
    const orderError = { ...logged('ERROR JSHandle@object'), args: 'ERROR {"message":"Something went wrong"}' };
    expect(unexpectedErrors([anyError, orderError], SUITE_WIDE_ALLOWANCES)).toEqual([anyError, orderError]);
  });

  test('a pinned defect is allowed only on the route of its page: the same TypeError anywhere else is unexpected', () => {
    const thrown = (text: string, route: string | undefined) => ({ kind: 'pageerror' as const, text, route });
    const value = "TypeError: Cannot read properties of undefined (reading 'value')";
    const name = "TypeError: Cannot read properties of undefined (reading 'name')";
    // BUG-47 belongs to the profile page, SEC-13 to the category page.
    expect(unexpectedErrors([thrown(value, '/account/profile')], SUITE_WIDE_ALLOWANCES)).toEqual([]);
    expect(unexpectedErrors([thrown(name, '/category/hand-tools')], SUITE_WIDE_ALLOWANCES)).toEqual([]);
    for (const route of ['/', '/checkout', '/account/favorites', '/admin/users', undefined]) {
      expect(unexpectedErrors([thrown(value, route)], SUITE_WIDE_ALLOWANCES), `an unrelated "reading 'value'" on ${route}`).toHaveLength(1);
    }
    for (const route of ['/', '/product/1', '/account/profile', undefined]) {
      expect(unexpectedErrors([thrown(name, route)], SUITE_WIDE_ALLOWANCES), `an unrelated "reading 'name'" on ${route}`).toHaveLength(1);
    }
    expect(unexpectedErrors([thrown("TypeError: Cannot read properties of undefined (reading 'email')", '/account/profile')], SUITE_WIDE_ALLOWANCES), 'another property on the pinned page').toHaveLength(1);
  });

  test('the 500 the shop answers for the related products of an unknown id is allowed on the product page, and only there', () => {
    const related = (route: string) => ({ ...logged('ERROR yi'), route, args: `ERROR {"status":500,"statusText":"Internal Server Error","url":"${API('/products/0000/related')}","message":"Product with ID 0000 not found","name":"HttpErrorResponse"}` });
    expect(unexpectedErrors([related('/product/0000')], SUITE_WIDE_ALLOWANCES)).toEqual([]);
    expect(unexpectedErrors([related('/checkout')], SUITE_WIDE_ALLOWANCES), 'on another page').toHaveLength(1);
    // The browser's own line for the same answer (Chromium and WebKit print it, Firefox does not).
    const resourceLine = (path: string, route: string) => ({ ...failedResource(500, path), route });
    expect(unexpectedErrors([resourceLine('/products/0000/related', '/product/0000')], SUITE_WIDE_ALLOWANCES), 'the resource line on the product page').toEqual([]);
    expect(unexpectedErrors([resourceLine('/products/0000/related', '/')], SUITE_WIDE_ALLOWANCES), 'the resource line on another page').toHaveLength(1);
    expect(unexpectedErrors([resourceLine('/products/0000', '/product/0000')], SUITE_WIDE_ALLOWANCES), 'a 500 of the product itself').toHaveLength(1);
    const otherMessage = { ...related('/product/0000'), args: `ERROR {"status":500,"url":"${API('/products/0000/related')}","message":"Server Error","name":"HttpErrorResponse"}` };
    expect(unexpectedErrors([otherMessage], SUITE_WIDE_ALLOWANCES), 'a 500 that is not "Product with ID … not found"').toHaveLength(1);
  });

  test('the 500 of GET /users/refresh is allowed on the pages that ask it, and no other 500 is', () => {
    const refused = (path: string, route: string | undefined) => ({ ...failedResource(500, path), route });
    for (const route of ['/account', '/account/profile', '/auth/login']) {
      expect(unexpectedErrors([refused('/users/refresh', route)], SUITE_WIDE_ALLOWANCES), `the refresh on ${route}`).toEqual([]);
    }
    expect(unexpectedErrors([refused('/users/refresh', '/checkout')], SUITE_WIDE_ALLOWANCES), 'the refresh on a page that never asks it').toHaveLength(1);
    expect(unexpectedErrors([refused('/users/refresh', undefined)], SUITE_WIDE_ALLOWANCES), 'the refresh from an unknown page').toHaveLength(1);
    expect(unexpectedErrors([refused('/users/me', '/account')], SUITE_WIDE_ALLOWANCES), 'another endpoint answering 500 on the same page').toHaveLength(1);
    expect(unexpectedErrors([refused('/users/refresh/extra', '/account')], SUITE_WIDE_ALLOWANCES), 'another path with the same prefix').toHaveLength(1);
  });

  test('every pinned defect an allowance covers matches the line of each engine and names its pin', () => {
    const lines: Record<string, string[]> = {
      'BUG-37': ['[angularx-qrcode] Field `qrdata` is empty, set \'allowEmptyString="true"\' to overwrite this behaviour.'],
      'BUG-38': ["TypeError: Cannot read properties of null (reading 'cart_items')", "TypeError: null is not an object (evaluating 'e.cart_items')", 'TypeError: can\'t access property "cart_items", e is null'],
      'SEC-13': ["TypeError: Cannot read properties of undefined (reading 'name')", "TypeError: undefined is not an object (evaluating 'this.categories[0].name')", 'TypeError: this.categories[0] is undefined'],
      'BUG-02': ["NG04002: 'this/route/does/not/exist'"],
      'BUG-47': ["TypeError: Cannot read properties of undefined (reading 'value')", "TypeError: undefined is not an object (evaluating 'e.password.value')", 'TypeError: can\'t access property "value", e is undefined'],
      'BUG-54': ['Failed to load resource: the server responded with a status of 500 (Internal Server Error)'],
      'ADM-21': ['NG01002: Must supply a value for form control with name: enabled'],
    };
    expect(PINNED_DEFECT_LOGS.map(({ id }) => id).sort()).toEqual(Object.keys(lines).sort());
    for (const { id, pattern } of PINNED_DEFECT_LOGS) for (const line of lines[id]) expect(pattern.test(line), `${id} should match "${line}"`).toBe(true);
  });

  test('an error is described on one line, with its URL', () => {
    expect(describeError(logged('first line\nsecond', httpUrl('x', '/y')))).toBe(`[console] first line (${httpUrl('x', '/y')})`);
  });
});

// The console guard (src/support/console-guard.ts): which errors the browser logs or throws are allowed, and which fail the test. The
// teardown that applies it is probed in fixture-teardown.spec.ts. No browser: pure functions.
import { expect, test, type Page } from '@playwright/test';
import { test as fixtureTest } from '@fixtures';
import { allowancesFor, describeError, isApiResourceFailure, PINNED_DEFECT_LOGS, SUITE_WIDE_ALLOWANCES, unexpectedErrors, type ExpectedStatus } from '@support/console-guard';
import { API_URL, BASE_URL } from '@support/env';
import { httpUrl } from '@support/urls';
import { LOGGED_FAILED_REQUEST } from '@pages/admin/alerts';

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

  const answer = (method: string, pathname: string, status: number) => ({ method, pathname, status });

  test('the browser line for a failed API request is allowed only for a status the shop answered that path with, or an answer a mock gave', () => {
    const assetFailure = logged('Failed to load resource: net::ERR_FAILED', httpUrl('localhost', '/assets/logo.png'));
    const got = (status: number, path: string) => [answer('GET', path, status)];
    expect(isApiResourceFailure(failedResource(401, '/users/me'), [], got(401, '/users/me'))).toBe(true);
    const optedIn = (status: number, path: ExpectedStatus['path']): ExpectedStatus[] => [{ status, path, reason: 'the test provokes it' }];
    expect(isApiResourceFailure(failedResource(404, '/products/0000'), [], got(404, '/products/0000')), 'a 404 nobody opted into').toBe(false);
    expect(isApiResourceFailure(failedResource(404, '/products/0000'), [], got(404, '/products/0000'), optedIn(404, /^\/products\//))).toBe(true);
    expect(isApiResourceFailure(failedResource(422, '/carts/1/product/quantity'), [], got(422, '/carts/1/product/quantity'), optedIn(422, '/carts/1/product/quantity')), 'the shop refusing invalid input').toBe(true);
    expect(isApiResourceFailure(failedResource(409, '/brands'), [], got(409, '/brands'), optedIn(409, '/brands')), 'the shop refusing a conflicting one').toBe(true);
    expect(isApiResourceFailure(failedResource(409, '/brands'), [], got(409, '/brands'), optedIn(409, '/categories')), 'opted in for another path').toBe(false);
    expect(isApiResourceFailure(failedResource(409, '/brands'), [], got(409, '/brands'), optedIn(422, '/brands')), 'opted in for another status').toBe(false);
    expect(isApiResourceFailure(failedResource(404, '/products/0000'), [], [], optedIn(404, /^\/products\//)), 'opted in, but the shop never answered that').toBe(false);
    expect(isApiResourceFailure(failedResource(404, '/products/0000')), 'an expected status with no such answer received').toBe(false);
    expect(isApiResourceFailure(failedResource(404, '/products/0000'), [], got(404, '/brands')), 'the answer was for another path').toBe(false);
    expect(isApiResourceFailure(failedResource(404, '/products/0000'), [], got(200, '/products/0000')), 'the path answered with another status').toBe(false);
    expect(isApiResourceFailure(assetFailure, [], got(404, '/products/0000')), 'a broken asset').toBe(false);
    expect(isApiResourceFailure(failedResource(500, '/products'), [], got(500, '/products')), 'a 5xx nobody mocked').toBe(false);
    expect(isApiResourceFailure(logged('Failed to load resource: net::ERR_CONNECTION_REFUSED', API('/products'))), 'a refused connection').toBe(false);
    expect(isApiResourceFailure(failedResource(403, '/users/me'), [], got(403, '/users/me')), 'a status that is not expected').toBe(false);
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
    const answers = [answer('GET', '/users/me', 401), answer('GET', '/products/0000', 404)];
    const notCancelled = [me401, failedResource(401, '/users/me'), unauthorizedLog, chromium, unknownProduct];
    expect(unexpectedErrors([...notCancelled, cancelled], allowancesFor('webkit'), [], answers)).toEqual([]);
    expect(unexpectedErrors([...notCancelled, cancelled], allowancesFor('chromium'), [], answers), 'the cancelled XHR is allowed in WebKit only').toEqual([cancelled]);
    expect(unexpectedErrors([...notCancelled, cancelled], allowancesFor('firefox'), [], answers)).toEqual([cancelled]);
  });

  test('an "Unauthorized" log needs a 401 of GET /users/me the browser received, in any engine, and as many logs as subscribers echo it', () => {
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

  test('the line the SPA logs for a failed request is allowed in both its shapes, and only in a test in which a request failed', () => {
    const allowance = [{ pattern: LOGGED_FAILED_REQUEST, reason: 'a mocked failure', requiresFailure: true }];
    const chromium = logged('ERROR Error: Server Error');
    const firefox = { ...logged('ERROR Error'), args: '"ERROR" Error: Server Error' };
    const firefoxObject = { ...logged('ERROR JSHandle@object'), args: `"ERROR" {"status":500,"url":"${API('/brands/1')}","name":"HttpErrorResponse"}` };
    const firefoxBody = { ...logged('ERROR JSHandle@object'), args: '"ERROR" {"message":"Server Error"}' };
    const service = { ...logged('BrandService Error: JSHandle@object'), args: '"BrandService Error:" {"status":500}' };
    const unrelated = { ...logged('ERROR Error'), args: '"ERROR" TypeError: x is undefined' };
    const mockedFailure = [{ pathname: '/brands/1', outcome: 500 as const }];
    const refused = [answer('GET', '/brands/1', 500)];
    for (const [shape, error] of Object.entries({ chromium, firefox, firefoxObject, firefoxBody, service })) {
      expect(unexpectedErrors([error], allowance, mockedFailure), `${shape}: a mock answered with a failure`).toEqual([]);
      expect(unexpectedErrors([error], allowance, [], refused), `${shape}: the shop answered with a failure`).toEqual([]);
      expect(unexpectedErrors([error], allowance, [{ pathname: '/brands/1', outcome: 'aborted' }]), `${shape}: a mock aborted the request`).toEqual([]);
      expect(unexpectedErrors([error], allowance), `${shape}: no request failed`).toEqual([error]);
      expect(unexpectedErrors([error], allowance, [{ pathname: '/brands/1', outcome: 200 }], [answer('GET', '/brands/1', 200)]), `${shape}: every answer was a success`).toEqual([error]);
    }
    expect(unexpectedErrors([unrelated], allowance, mockedFailure, refused), 'another error is not this line, failure or not').toEqual([unrelated]);
  });

  test('an error is described on one line, with its URL', () => {
    expect(describeError(logged('first line\nsecond', httpUrl('x', '/y')))).toBe(`[console] first line (${httpUrl('x', '/y')})`);
  });
});

// The window of `consoleGuard.expectNoneLogged` (fixtures/console-guard.ts), in a real page: a page of the probe's own route logs after a delay.
fixtureTest.describe('consoleGuard.expectNoneLogged', { tag: ['@framework'] }, () => {
  const PROBE = `${BASE_URL}/__probe-console`;
  const LOGS = /the probe logged/;
  const open = async (page: Page, logAfterMs: number) => {
    await page.route(PROBE, (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>probe</title><script>setTimeout(() => console.error('the probe logged this'), ${logAfterMs})</script>` }));
    await page.goto(PROBE);
  };

  fixtureTest('rejects an error logged inside its window', async ({ page, consoleGuard }) => {
    consoleGuard.allow(LOGS, 'provoked on purpose');
    await open(page, 200);
    await expect(consoleGuard.expectNoneLogged(LOGS, { within: 5_000 })).rejects.toThrow(/within 5000 ms, but one was logged/);
  });

  fixtureTest('rejects an error logged before the call', async ({ page, consoleGuard }) => {
    consoleGuard.allow(LOGS, 'provoked on purpose');
    await open(page, 0);
    await expect.poll(() => consoleGuard.logged(LOGS)).toHaveLength(1);
    await expect(consoleGuard.expectNoneLogged(LOGS, { within: 100 })).rejects.toThrow(/already logged/);
  });

  fixtureTest('passes when nothing matching is logged in its window, and ignores other errors', async ({ page, consoleGuard }) => {
    consoleGuard.allow(LOGS, 'provoked on purpose');
    await open(page, 200);
    await expect(consoleGuard.expectNoneLogged(/a line nobody logs/, { within: 600 })).resolves.toBeUndefined();
  });
});

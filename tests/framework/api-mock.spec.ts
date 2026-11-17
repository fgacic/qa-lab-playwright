// The suite's own plumbing under test: src/support/api-mock.ts and src/support/env.ts. A specification that
// "proves no request was sent" is only worth what `expectNoRequest` is worth, so its failure modes are
// asserted here, once, in Chromium. These use the plain Playwright `test` on purpose: they build their own
// ApiMock, and the suite's `page` fixture would already have installed one on the same page.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ApiMock, isAllowedAnonymousWrite, mock } from '@support/api-mock';
import { API_URL, BASE_URL, writeGuardDefault } from '@support/env';
import { httpUrl, httpsUrl } from '@support/urls';
import { deliveryOrder, fetchOutcome, fetchStatus } from '@support/page-fetch';

const ROOT = join(__dirname, '..', '..');
const BRANDS = '/brands';
const CATEGORIES = '/categories';
// Each `--list` below loads the config in a fresh process: the spawn's own limit, and the budget of a test that runs one (or three) of them.
const CONFIG_LOAD_MS = 60_000;

test.describe('the mock layer', { tag: ['@framework', '@self-hosted'] }, () => {
  /** A blank same-origin document, so `fetch` to the API is not cross-origin and no real page loads. */
  async function openBlankPage(page: Page): Promise<void> {
    await page.route(`${BASE_URL}/__framework`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>framework</title>' }));
    await page.goto(`${BASE_URL}/__framework`);
  }
  const send = (page: Page, method: string, path: string, body?: unknown) => fetchStatus(page, `${API_URL}${path}`, method, body);

  test('expectNoRequest fails on a request sent inside its window', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', BRANDS, []));
    await openBlankPage(page);

    const absent = apiMock.expectNoRequest('GET', BRANDS, { within: 3_000 });
    const rejection = expect(absent).rejects.toThrow(/Expected no GET \/brands within 3000 ms, but one was sent/);
    await send(page, 'GET', BRANDS);
    await rejection;
  });

  test('expectNoRequest fails on a request sent before the call', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', BRANDS, []));
    await openBlankPage(page);
    await send(page, 'GET', BRANDS);

    await expect(apiMock.expectNoRequest('GET', BRANDS, { within: 100 })).rejects.toThrow(/already sent/);
  });

  test('expectNoRequest passes when no such request is sent, and ignores other endpoints and methods', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', BRANDS, []), mock.respond('POST', BRANDS, {}, 201));
    await openBlankPage(page);
    await send(page, 'POST', BRANDS, {});

    await apiMock.expectNoRequest('GET', BRANDS, { within: 300 });
  });

  test('a sequence answers in the order of asking and repeats its last answer, and a new mock replays it from the start', async ({ page }) => {
    const sequence = mock.sequence('GET', BRANDS, { status: 500, json: { message: 'first' } }, { status: 200, json: [{ id: 'second' }] }, { status: 404, json: { message: 'last' } });
    const apiMock = new ApiMock(page);
    await apiMock.use(sequence);
    await openBlankPage(page);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push(await send(page, 'GET', BRANDS));
    expect(statuses).toEqual([500, 200, 404, 404, 404]);

    const again = new ApiMock(page);
    await again.use(sequence);
    expect(await send(page, 'GET', BRANDS), 'the route itself is untouched: a describe-level sequence starts over in the next test').toBe(500);
  });

  test('a mock of the test overrides a default for the same endpoint, whichever was registered first; a default answers where nothing else does', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.useDefaults(mock.respond('GET', BRANDS, [], 200), mock.respond('GET', CATEGORIES, [], 200));
    await apiMock.use(mock.fail('GET', BRANDS, 503));
    await openBlankPage(page);
    expect(await send(page, 'GET', BRANDS), 'the test mock wins').toBe(503);
    expect(await send(page, 'GET', CATEGORIES), 'the default answers').toBe(200);

    const later = new ApiMock(page);
    await later.use(mock.fail('GET', CATEGORIES, 502));
    await later.useDefaults(mock.respond('GET', CATEGORIES, [], 200));
    expect(await send(page, 'GET', CATEGORIES), 'a default registered after a mock still loses to it').toBe(502);
  });

  test('a path pattern with the /g flag is refused up front, by every method that takes one', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await expect(apiMock.expectNoRequest('GET', /brands/g, { within: 0 })).rejects.toThrow(/must not use the \/g or \/y flag/);
    expect(() => apiMock.waitForRequest('GET', /brands/y)).toThrow(/must not use the \/g or \/y flag/);
    await expect(apiMock.waitForResponse('GET', /brands/g)).rejects.toThrow(/must not use the \/g or \/y flag/);
  });

  test('waitForRequest and waitForResponse answer to the API only, not to another origin with the same path', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', BRANDS, []));
    // The same path on the shop's own origin, outside the API prefix: not an API request.
    await page.route(`${BASE_URL}/brands`, (route) => route.fulfill({ contentType: 'text/plain', body: 'not the API' }));
    await openBlankPage(page);

    const request = apiMock.waitForRequest('GET', BRANDS, { timeout: 1_500 });
    const response = apiMock.waitForResponse('GET', BRANDS, () => true, { timeout: 1_500 });
    const settled = Promise.allSettled([request, response]);
    await fetchStatus(page, `${BASE_URL}/brands`);
    expect((await settled).map((r) => r.status), 'a request outside the API prefix must not satisfy either wait').toEqual(['rejected', 'rejected']);

    const real = apiMock.waitForRequest('GET', BRANDS);
    await send(page, 'GET', BRANDS);
    expect((await real).url()).toBe(`${API_URL}/brands`);
  });

  test('the write guard answers an unmocked write with 418 and records it, but lets mocked writes through', async ({ page }) => {
    const apiMock = new ApiMock(page, 0, true);
    await apiMock.use(mock.respond('POST', BRANDS, { id: 'mocked' }, 201));
    await openBlankPage(page);

    expect(await send(page, 'POST', BRANDS, {}), 'a mocked write is answered by its mock').toBe(201);
    expect(await send(page, 'PUT', '/brands/1', {}), 'an unmocked write is refused').toBe(418);
    expect(await send(page, 'DELETE', '/brands/1'), 'every write method is guarded').toBe(418);
    expect(apiMock.blockedWrites).toEqual(['PUT /brands/1', 'DELETE /brands/1']);
  });

  test('without the write guard an unmocked write reaches the real API', async ({ page }) => {
    const apiMock = new ApiMock(page, 0, false);
    await openBlankPage(page);

    // The real API refuses an anonymous brand delete with 401: anything but the guard's 418 proves it was let through.
    expect(await send(page, 'DELETE', '/brands/does-not-exist')).not.toBe(418);
    expect(apiMock.blockedWrites).toEqual([]);
  });

  test('mark() and since count only the requests after the mark, for expectNoRequest and requestsTo alike', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', BRANDS, []));
    await openBlankPage(page);
    await send(page, 'GET', BRANDS); // the page's own load

    const before = await apiMock.mark();

    expect(apiMock.requestsTo('GET', BRANDS), 'without a mark the earlier request counts').toBe(1);
    expect(apiMock.requestsTo('GET', BRANDS, { since: before })).toBe(0);
    await apiMock.expectNoRequest('GET', BRANDS, { within: 100, since: before });
    await send(page, 'GET', BRANDS);
    expect(apiMock.requestsTo('GET', BRANDS, { since: before })).toBe(1);
    await expect(apiMock.expectNoRequest('GET', BRANDS, { within: 100, since: before })).rejects.toThrow(/already sent/);
  });

  test('a delay predicate that throws is recorded for the page fixture to fail on, and does not hold the request', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('QUERY', '/products', { data: [] }));
    // One rule: it holds 'slow' (a working predicate, the reference) and throws on 'broken', which must then be answered at once.
    await apiMock.delay('QUERY', '/products', (body) => { if (body.page === 'broken') throw new Error('broken predicate'); return body.page === 'slow'; }, 700);
    await openBlankPage(page);

    const order = await deliveryOrder(page, `${API_URL}/products`, ['slow', 'broken']); // 'slow' is asked first
    expect(order, 'the broken request was not held back: it was answered before the held one').toEqual(['broken', 'slow']);
    expect(apiMock.handlerErrors).toEqual([expect.stringMatching(/delay\(QUERY \/products\) threw: broken predicate/)]);
  });

  test('a CORS preflight is answered by the mock for a mocked path, and goes to the real API for any other', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', BRANDS, [{ id: 'mocked' }]));
    // Another origin than the API's (127.0.0.1 for localhost), so the browser really sends a preflight for the custom header.
    const other = new URL(BASE_URL);
    other.hostname = '127.0.0.1';
    await page.route(`${other.origin}/__framework`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>framework</title>' }));
    await page.goto(`${other.origin}/__framework`);

    const mocked = await fetchOutcome(page, `${API_URL}/brands`, 'GET', { 'x-qa-lab': '1' });
    const real = await fetchOutcome(page, `${API_URL}/categories/tree`, 'GET', { 'x-qa-lab': '1' });

    expect(mocked, 'the preflight of a mocked path is answered, and then the mocked GET').toBe(200);
    expect(apiMock.requestsTo('GET', BRANDS)).toBe(1);
    // No mock serves it, so the mock layer must not paper over the real API's own preflight answer: the self-hosted API does
    // not allow another origin to send this header, and the browser refuses. A canned mock answer would have let it through.
    expect(real, "the real API's refusal shows through").toBe('TypeError');
  });

  test('the live default of the write guard is on for the projects that must never write, and off for the real-write ones', async () => {
    expect(writeGuardDefault(false, 'chromium'), 'live, a browser project').toBe(true);
    expect(writeGuardDefault(false, 'mobile')).toBe(true);
    expect(writeGuardDefault(false, 'account'), 'live, but the project opted in to real sign-ins').toBe(false);
    expect(writeGuardDefault(false, 'admin-setup')).toBe(false);
    expect(writeGuardDefault(true, 'chromium'), 'self-hosted: writes are the point').toBe(false);
  });

  test('a write the live guard lets through is an anonymous cart call, and nothing else', async () => {
    const allowed: [string, string][] = [
      ['POST', '/carts'], ['POST', '/carts/01ABC'], ['PUT', '/carts/01ABC/product/quantity'], ['DELETE', '/carts/01ABC/product/01P'],
    ];
    const refused: [string, string][] = [
      ['POST', '/carts/01ABC/extra'], ['POST', '/carts/'], ['DELETE', '/carts/01ABC'], ['PUT', '/carts/01ABC'], ['GET', '/carts'],
      ['POST', '/users/register'], ['POST', '/invoices'], ['POST', '/messages'], ['DELETE', '/products/01P'], ['POST', '/carts/a/b'],
      ['PUT', '/carts/01ABC/product/quantity/x'], ['DELETE', '/carts/01ABC/product/'], ['POST', '/api/carts'], ['POST', '/favorites'],
    ];
    for (const [method, path] of allowed) expect(isAllowedAnonymousWrite(method, path), `${method} ${path} is allowed`).toBe(true);
    for (const [method, path] of refused) expect(isAllowedAnonymousWrite(method, path), `${method} ${path} is refused`).toBe(false);
  });

  test('the write guard lets an anonymous cart write through even when it is on, and records nothing for it', async ({ page }) => {
    const apiMock = new ApiMock(page, 0, true);
    await openBlankPage(page);

    expect(await send(page, 'POST', '/carts', {}), 'the guard did not answer it').not.toBe(418);
    expect(apiMock.blockedWrites).toEqual([]);
  });

  test('delay holds back only the requests its predicate selects', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('QUERY', '/products', { data: [] }));
    await apiMock.delay('QUERY', '/products', (body) => body.page === 'slow', 700);
    await openBlankPage(page);

    const order = await deliveryOrder(page, `${API_URL}/products`, ['slow', 'fast']); // 'slow' is asked first
    expect(order, 'the selected request is held back, so the one asked after it is answered first').toEqual(['fast', 'slow']);
  });

  test('serialize delivers real answers in the order the requests were sent, even when an earlier one is held back', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.serialize('QUERY', '/products');
    await apiMock.delay('QUERY', '/products', (body) => body.page === '1', 600);
    await openBlankPage(page);

    const order = await deliveryOrder(page, `${API_URL}/products`, ['1', '2']); // the first is held back by the delay above
    expect(order, 'the second answer was ready first, but waited for the first').toEqual(['1', '2']);
  });
});

test.describe('the target configuration', { tag: ['@framework'] }, () => {
  /** `playwright test --list` loads the config in a fresh process with this environment, which is where env.ts runs. */
  test.describe.configure({ timeout: 3 * CONFIG_LOAD_MS + 15_000 }); // the loopback test loads the config three times
  const loadConfig = (env: Record<string, string>) =>
    spawnSync('npx', ['playwright', 'test', '--list', '--project=framework'], { cwd: ROOT, timeout: CONFIG_LOAD_MS, encoding: 'utf8', env: { ...process.env, ...env } });

  test('a local target whose BASE_URL and API_URL are on different origins is refused', () => {
    const base = httpUrl('localhost');
    const api = httpUrl('localhost', '/api', 8091);
    const run = loadConfig({ TARGET: 'local', BASE_URL: base, API_URL: api });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain(`BASE_URL (${base}) and API_URL (${api}) on the same origin`);
  });

  /** BASE_URL and API_URL of a shop at `host`: the self-hosted layout, the API under /api on the same origin. */
  const urls = (host: string) => ({ BASE_URL: httpUrl(host), API_URL: httpUrl(host, '/api') });
  const REFUSED_ENV: { name: string; env: Record<string, string>; message: RegExp }[] = [
    { name: 'an unknown TARGET', env: { TARGET: 'prod' }, message: /Unknown TARGET "prod"/ },
    { name: 'a host that merely starts with localhost', env: urls('localhost.evil.com'), message: /are not local/ },
    { name: 'a userinfo that spells localhost before the real host', env: urls('localhost@evil.com'), message: /are not local/ },
    { name: '0.0.0.0, which is not our loopback', env: urls('0.0.0.0'), message: /are not local/ },
    { name: 'an IPv6 literal that is not ::1', env: urls('[::2]'), message: /are not local/ },
    { name: 'a private LAN address', env: urls('192.168.1.5'), message: /are not local/ },
    { name: 'a local BASE_URL with a live API_URL', env: { BASE_URL: httpUrl('localhost'), API_URL: httpsUrl('api.practicesoftwaretesting.com') }, message: /are not local/ },
  ];
  for (const { name, env, message } of REFUSED_ENV) {
    test(`TARGET=local refuses ${name}`, () => {
      const run = loadConfig({ TARGET: 'local', ...env });
      expect(run.status, `${run.stdout}${run.stderr}`).not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toMatch(message);
    });
  }

  test('the loopback spellings of this machine are accepted', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const run = loadConfig({ TARGET: 'local', ...urls(host) });
      expect(run.status, `${host}: ${run.stdout}${run.stderr}`).toBe(0);
    }
  });

  test('TARGET=live accepts the public addresses, and its write guard default is on', () => {
    const run = loadConfig({ TARGET: 'live' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  test('a run that schedules perf next to another project is refused at load time when --reporter replaced the guard', () => {
    const run = spawnSync('npx', ['playwright', 'test', '--project=perf', '--project=chromium', '--reporter=dot', '--grep=@nothing-has-this-tag'], { cwd: ROOT, timeout: CONFIG_LOAD_MS, encoding: 'utf8', env: process.env });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toMatch(/perf budgets must run alone/);
  });

  test('a trailing slash on API_URL is dropped, so the API prefix still matches', () => {
    const run = loadConfig({ TARGET: 'local', BASE_URL: httpUrl('localhost'), API_URL: httpUrl('localhost', '/api/') });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });
});

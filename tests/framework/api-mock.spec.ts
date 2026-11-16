// The suite's own plumbing under test: src/support/api-mock.ts and src/support/env.ts. A specification that
// "proves no request was sent" is only worth what `expectNoRequest` is worth, so its failure modes are
// asserted here, once, in Chromium. These use the plain Playwright `test` on purpose: they build their own
// ApiMock, and the suite's `page` fixture would already have installed one on the same page.
import { spawnSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { ApiMock, mock } from '@support/api-mock';
import { API_URL, BASE_URL } from '@support/env';

test.describe('the mock layer', { tag: ['@framework', '@self-hosted'] }, () => {
  /** A blank same-origin document, so `fetch` to the API is not cross-origin and no real page loads. */
  async function openBlankPage(page: Page): Promise<void> {
    await page.route(`${BASE_URL}/__framework`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>framework</title>' }));
    await page.goto(`${BASE_URL}/__framework`);
  }
  const send = (page: Page, method: string, path: string, body?: unknown) =>
    page.evaluate(
      async ({ url, method, body }) => {
        const response = await fetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
        return response.status;
      },
      { url: `${API_URL}${path}`, method, body },
    );

  test('expectNoRequest fails on a request sent inside its window', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', '/brands', []));
    await openBlankPage(page);

    const absent = apiMock.expectNoRequest('GET', '/brands', { within: 3_000 });
    const rejection = expect(absent).rejects.toThrow(/Expected no GET \/brands within 3000 ms, but one was sent/);
    await send(page, 'GET', '/brands');
    await rejection;
  });

  test('expectNoRequest fails on a request sent before the call', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', '/brands', []));
    await openBlankPage(page);
    await send(page, 'GET', '/brands');

    await expect(apiMock.expectNoRequest('GET', '/brands', { within: 100 })).rejects.toThrow(/already sent/);
  });

  test('expectNoRequest passes when no such request is sent, and ignores other endpoints and methods', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', '/brands', []), mock.respond('POST', '/brands', {}, 201));
    await openBlankPage(page);
    await send(page, 'POST', '/brands', {});

    await apiMock.expectNoRequest('GET', '/brands', { within: 300 });
  });

  test('a path pattern with the /g flag is refused up front, by every method that takes one', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await expect(apiMock.expectNoRequest('GET', /brands/g, { within: 0 })).rejects.toThrow(/must not use the \/g or \/y flag/);
    expect(() => apiMock.waitForRequest('GET', /brands/y)).toThrow(/must not use the \/g or \/y flag/);
    await expect(apiMock.waitForResponse('GET', /brands/g)).rejects.toThrow(/must not use the \/g or \/y flag/);
  });

  test('waitForRequest and waitForResponse answer to the API only, not to another origin with the same path', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('GET', '/brands', []));
    // The same path on the shop's own origin, outside the API prefix: not an API request.
    await page.route(`${BASE_URL}/brands`, (route) => route.fulfill({ contentType: 'text/plain', body: 'not the API' }));
    await openBlankPage(page);

    const request = apiMock.waitForRequest('GET', '/brands', { timeout: 1_500 });
    const response = apiMock.waitForResponse('GET', '/brands', () => true, { timeout: 1_500 });
    const settled = Promise.allSettled([request, response]);
    await page.evaluate((url) => fetch(url), `${BASE_URL}/brands`);
    expect((await settled).map((r) => r.status), 'a request outside the API prefix must not satisfy either wait').toEqual(['rejected', 'rejected']);

    const real = apiMock.waitForRequest('GET', '/brands');
    await send(page, 'GET', '/brands');
    expect((await real).url()).toBe(`${API_URL}/brands`);
  });

  test('the write guard answers an unmocked write with 418 and records it, but lets mocked writes through', async ({ page }) => {
    const apiMock = new ApiMock(page, 0, true);
    await apiMock.use(mock.respond('POST', '/brands', { id: 'mocked' }, 201));
    await openBlankPage(page);

    expect(await send(page, 'POST', '/brands', {}), 'a mocked write is answered by its mock').toBe(201);
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

  test('delay holds back only the requests its predicate selects', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.use(mock.respond('QUERY', '/products', { data: [] }));
    await apiMock.delay('QUERY', '/products', (body) => body.page === 'slow', 700);
    await openBlankPage(page);

    const timed = async (body: unknown) => {
      const started = Date.now();
      await send(page, 'QUERY', '/products', body);
      return Date.now() - started;
    };
    expect(await timed({ page: 'slow' }), 'the selected request is held back').toBeGreaterThanOrEqual(650);
    expect(await timed({ page: 'fast' }), 'another request is not').toBeLessThan(650);
  });

  test('serialize delivers real answers in the order the requests were sent, even when an earlier one is held back', async ({ page }) => {
    const apiMock = new ApiMock(page);
    await apiMock.serialize('QUERY', '/products');
    await apiMock.delay('QUERY', '/products', (body) => body.page === '1', 600);
    await openBlankPage(page);

    const order = await page.evaluate(async (url) => {
      const delivered: string[] = [];
      const ask = (pageNumber: string) =>
        fetch(url, { method: 'QUERY', body: JSON.stringify({ page: pageNumber }), headers: { 'content-type': 'application/json' } }).then(() => delivered.push(pageNumber));
      const first = ask('1'); // held back by the delay above
      await new Promise((resolve) => setTimeout(resolve, 50)); // so the second is certainly asked later
      await Promise.all([first, ask('2')]);
      return delivered;
    }, `${API_URL}/products`);
    expect(order, 'the second answer was ready first, but waited for the first').toEqual(['1', '2']);
  });
});

test.describe('the target configuration', { tag: ['@framework'] }, () => {
  /** `playwright test --list` loads the config in a fresh process with this environment, which is where env.ts runs. */
  const loadConfig = (env: Record<string, string>) =>
    spawnSync('npx', ['playwright', 'test', '--list', '--project=framework'], { encoding: 'utf8', env: { ...process.env, ...env } });

  test('a local target whose BASE_URL and API_URL are on different origins is refused', () => {
    const run = loadConfig({ TARGET: 'local', BASE_URL: 'http://localhost:4200', API_URL: 'http://localhost:8091/api' });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toMatch(/BASE_URL \(http:\/\/localhost:4200\) and API_URL \(http:\/\/localhost:8091\/api\) on the same origin/);
  });

  test('a trailing slash on API_URL is dropped, so the API prefix still matches', () => {
    const run = loadConfig({ TARGET: 'local', BASE_URL: 'http://localhost:4200', API_URL: 'http://localhost:4200/api/' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });
});

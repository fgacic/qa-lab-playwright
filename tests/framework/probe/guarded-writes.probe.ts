// Run only by tests/framework/fixture-teardown.spec.ts, through playwright.probe.config.ts. Each test sends a write from a
// blank page with the write guard on; the outcome the nested run reports is what the framework spec asserts.
import { expect, test } from '@fixtures';
import { mock } from '@support/api-mock';
import { API_URL, BASE_URL } from '@support/env';
import { fetchStatus } from '@support/page-fetch';

test.beforeEach(async ({ page, apiMock }) => {
  await apiMock.blockUnmockedWrites();
  await page.route(`${BASE_URL}/__probe`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
  await page.goto(`${BASE_URL}/__probe`);
});

test('probe: an unmocked write', async ({ page }) => {
  expect(await fetchStatus(page, `${API_URL}/brands/1`, 'DELETE'), 'refused by the guard').toBe(418);
});

test('probe: a mocked write', async ({ page, apiMock }) => {
  await apiMock.use(mock.respond('POST', '/brands', { id: 'mocked' }, 201));
  expect(await fetchStatus(page, `${API_URL}/brands`, 'POST', {})).toBe(201);
});

test('probe: an error the page logs', async ({ page }) => {
  await page.evaluate(() => console.error('probe: the app logged this'));
});

test('probe: an error the page logs and the test allows', async ({ page, consoleGuard }) => {
  consoleGuard.allow(/probe: the app logged this/, 'provoked on purpose');
  await page.evaluate(() => console.error('probe: the app logged this'));
});

test('probe: an uncaught error in the page', async ({ page }) => {
  const thrown = page.waitForEvent('pageerror');
  await page.evaluate(() => { setTimeout(() => { throw new Error('probe: uncaught'); }, 0); });
  await thrown;
});

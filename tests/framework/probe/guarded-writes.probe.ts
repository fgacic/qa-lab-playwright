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

// The failures of the mock layer's own code surface at teardown, from the `page` fixture.
test('probe: a delay predicate that throws', async ({ page, apiMock }) => {
  await apiMock.use(mock.respond('GET', '/probe-delay', {}));
  await apiMock.delay('GET', '/probe-delay', () => { throw new Error('probe: the predicate broke'); }, 1);
  expect(await fetchStatus(page, `${API_URL}/probe-delay`)).toBe(200);
});

// The suite-wide allowances in a real page: what is allowed there, and what is not, by route and by request.
/** Opens a page at `path` of the shop, drawn by the probe's own route, so the error's route is the one the allowance is scoped to. */
async function openAt(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.route(`${BASE_URL}${path}`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }));
  await page.goto(`${BASE_URL}${path}`);
}
const throwReadingValue = () => setTimeout(() => { void (undefined as unknown as { value: string }).value; }, 0);

test('probe: a TypeError reading value on the profile page, the pinned defect (BUG-47)', async ({ page }) => {
  await openAt(page, '/account/profile');
  const thrown = page.waitForEvent('pageerror');
  await page.evaluate(throwReadingValue);
  await thrown;
});

test('probe: the same TypeError on another page', async ({ page }) => {
  await openAt(page, '/account/favorites');
  const thrown = page.waitForEvent('pageerror');
  await page.evaluate(throwReadingValue);
  await thrown;
});

test('probe: a 500 of the API that no mock of the test answered', async ({ page }) => {
  await page.route(`${API_URL}/probe-500`, (route) => route.fulfill({ status: 500, body: '{}', contentType: 'application/json' }));
  expect(await fetchStatus(page, `${API_URL}/probe-500`)).toBe(500);
});

test('probe: a 500 of the API that a mock of the test answered', async ({ page, apiMock }) => {
  await apiMock.use(mock.fail('GET', '/probe-500'));
  expect(await fetchStatus(page, `${API_URL}/probe-500`)).toBe(500);
});

test('probe: an Unauthorized log with the 401 of GET /users/me behind it', async ({ page, apiMock }) => {
  await apiMock.use(mock.fail('GET', '/users/me', 401));
  expect(await fetchStatus(page, `${API_URL}/users/me`)).toBe(401);
  await page.evaluate(() => console.error('ERROR', { message: 'Unauthorized' }));
});

test('probe: an Unauthorized log with no 401 behind it', async ({ page }) => {
  await page.evaluate(() => console.error('ERROR', { message: 'Unauthorized' }));
});

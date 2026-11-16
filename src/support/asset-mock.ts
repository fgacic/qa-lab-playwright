import type { Page } from '@playwright/test';

/**
 * Answers a static file of the shop (a translation file, say: `assets/i18n/de.json`), not an API call, with `status`. The mock
 * layer (api-mock.ts) routes the API only, so a failing asset has its one route here, installed on the context like the layer's
 * own: a popup the test opens is covered too, and a route lives and dies with the test's context.
 */
export async function failAsset(page: Page, pathname: RegExp, status = 500): Promise<void> {
  await page.context().route((url) => pathname.test(url.pathname), (route) => route.fulfill({ status }));
}

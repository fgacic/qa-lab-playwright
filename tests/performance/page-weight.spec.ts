import { expect, test } from '@fixtures';
import { measurePageWeight } from '@support/page-weight';

/**
 * What a first visit downloads. A budget on the bytes and the requests is a limit the timing budgets (budgets.spec.ts) do not give: a doubled bundle
 * on a fast container still paints in time, and costs a real phone on a real network. Measured over the wire as the container sends it
 * (its nginx does not compress, docker/ui-nginx.conf, so the numbers are the uncompressed sizes: the live site, behind Cloudflare, sends
 * fewer), with the browser's cache off, and ending on the same visible element the timing budgets end on. The load is the page alone, no
 * click: the sizes are the same every run (a repeat adds nothing), so there is no sample count, no throttling and no baseline file.
 *
 * Each ceiling is the measured value plus about 25%, rounded up to 50 kB or 2 requests: room for a new image or a small dependency, not
 * for a second copy of the framework. Measured on the self-hosted shop: home 1 419 891 B in 40 requests (scripts 912 408 B), product
 * page 1 330 489 B in 34 requests (scripts 912 408 B).
 */
const WEIGHT_CEILING = {
  home: { bytes: 1_800_000, requests: 50, scriptBytes: 1_150_000 },
  product: { bytes: 1_700_000, requests: 44, scriptBytes: 1_150_000 },
} as const;

/** What a first load may weigh: the same four checks for every page, each reported on its own (soft). */
function expectWithinWeight(weight: Awaited<ReturnType<typeof measurePageWeight>>, ceiling: (typeof WEIGHT_CEILING)[keyof typeof WEIGHT_CEILING]) {
  expect.soft(weight.requests, 'requests made (a load that made none measured nothing)').toBeGreaterThan(0);
  expect.soft(weight.bytes, `bytes received; the heaviest: ${weight.heaviest.map(({ url, bytes }) => `${url} ${bytes}`).join(', ')}`).toBeLessThanOrEqual(ceiling.bytes);
  expect.soft(weight.requests, 'requests made').toBeLessThanOrEqual(ceiling.requests);
  expect.soft(weight.scriptBytes, 'script bytes received').toBeLessThanOrEqual(ceiling.scriptBytes);
}

test.describe('Page weight (self-hosted)', { tag: ['@perf', '@self-hosted'] }, () => {
  // No collector and no throttling: the bytes do not depend on speed, and a throttled load would only make the test slower.
  test.use({ measureVitals: false });

  test('home: the first load stays within its byte and request budget', async ({ homePage }) => {
    const start = homePage.page.url();

    const weight = await measurePageWeight(homePage.page, async () => {
      await homePage.page.goto(start, { waitUntil: 'load' });
      await expect(homePage.grid.cards.first()).toBeVisible();
    });

    expectWithinWeight(weight, WEIGHT_CEILING.home);
  });

  test('product page: the first load stays within its byte and request budget', async ({ productPage }) => {
    const start = productPage.page.url();

    const weight = await measurePageWeight(productPage.page, async () => {
      await productPage.page.goto(start, { waitUntil: 'load' });
      await expect(productPage.addToCartButton).toBeVisible();
    });

    expectWithinWeight(weight, WEIGHT_CEILING.product);
  });
});

/** The control for the page-weight budget: a document of a known size, served by a route, must be counted in bytes, as a request and as a non-script. */
test.describe('Performance collector (control)', { tag: ['@perf', '@self-hosted'] }, () => {
  test.use({ measureVitals: true });

  test('counts a known document in the page weight', async ({ homePage }) => {
    const KNOWN_BYTES = 20_000;
    await homePage.page.route('**/qa-weight-probe', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'x'.repeat(KNOWN_BYTES) }));

    const weight = await measurePageWeight(homePage.page, async () => {
      await homePage.page.goto('/qa-weight-probe');
    });

    expect(weight.requests, 'the document was one request').toBe(1);
    expect(weight.bytes, 'the 20 000 byte body was counted (headers come on top)').toBeGreaterThanOrEqual(KNOWN_BYTES);
    expect(weight.bytes, 'and nothing but a header block was added to it').toBeLessThan(KNOWN_BYTES + 2_000);
    expect(weight.scriptBytes, 'a document is not a script').toBe(0);
    expect(weight.heaviest[0], 'the heaviest response is that document').toMatchObject({ url: expect.stringContaining('/qa-weight-probe') });
  });
});

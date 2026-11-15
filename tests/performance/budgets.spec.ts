import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import type { Measurement, Vitals } from '@fixtures/performance';

/**
 * Performance budgets per key page, measured on the self-hosted Toolshop (a production build
 * served by nginx, see docker/). Live numbers would measure Cloudflare, the network and other
 * people's load, not the shop.
 *
 * What a budget means here: the browser is slowed to 4x CPU and a 40 ms, 10 Mbps connection
 * (THROTTLING in fixtures/performance.ts), and each number is the median of 3 fresh loads. The
 * limits are Google's Core Web Vitals "good" limits (web.dev/articles/vitals): LCP 2.5 s, CLS 0.1,
 * INP 200 ms; TBT, the lab stand-in for INP during load (long tasks before the first input), uses
 * Lighthouse's 200 ms "good" limit.
 * So "within budget" reads: a mid-range phone on a good connection gets a good experience. It
 * is not the speed of the container itself, which would be far inside any budget. Each test also
 * asserts that its evidence exists (an LCP entry, an interaction), so a run that observed nothing
 * fails instead of passing on zeros. Measured values are attached to every test and listed in
 * docs/COVERAGE.md.
 *
 * Those limits only catch a gross regression: the shop sits far inside them. So every budget has
 * a second limit, the median recorded in tests/performance/baseline.json for the environment (ci or
 * local) plus 30% (and a noise floor, see fixtures/performance.ts), which catches a slide that stays inside
 * the good range. An environment with no recorded baseline is held to the budgets only, and says so.
 * Record the baseline anew after a deliberate change with `UPDATE_PERF_BASELINE=1 npm run test:perf`.
 *
 * Scoped in playwright.config.ts: @perf runs in its own Chromium project, one worker and no
 * parallelism (LCP, layout-shift and longtask entries are Chromium's, and a busy CPU skews TBT
 * and INP), @self-hosted keeps it off the live site.
 */
test.use({ measureVitals: true });

const BUDGET: Vitals = { lcp: 2_500, cls: 0.1, tbt: 200, inp: 200 };

/** What the scenarios filter by and search for, named once. */
const FILTER_CATEGORY = 'Pliers';
const SEARCH_TERM = 'hammer';

const RESPONSIVE_METRICS: (keyof Vitals)[] = ['lcp', 'tbt', 'inp'];

/** Speed and responsiveness: the page is loaded, used once, and judged by what that cost. */
function expectResponsive({ median, observed }: Measurement, limit: Partial<Vitals> | undefined) {
  expect.soft(observed.lcpEntries, 'an LCP entry was observed').toBeGreaterThan(0);
  expect.soft(observed.interactions, 'an interaction was observed').toBeGreaterThan(0);
  expect.soft(median.lcp, 'LCP (ms)').toBeLessThanOrEqual(BUDGET.lcp);
  expect.soft(median.tbt, 'TBT (ms)').toBeLessThanOrEqual(BUDGET.tbt);
  expect.soft(median.inp, 'INP proxy (ms)').toBeLessThanOrEqual(BUDGET.inp);
  if (!limit) return; // no baseline recorded for this environment: the fixture annotated it, the budgets above still hold
  expect.soft(median.lcp, 'LCP (ms) against its baseline').toBeLessThanOrEqual(limit.lcp!);
  expect.soft(median.tbt, 'TBT (ms) against its baseline').toBeLessThanOrEqual(limit.tbt!);
  expect.soft(median.inp, 'INP proxy (ms) against its baseline').toBeLessThanOrEqual(limit.inp!);
}

/**
 * Speed and responsiveness under throttling. Layout stability is tested apart, below: it depends
 * on a race and needs a controlled API latency to measure reliably.
 */
test.describe('Performance budgets (self-hosted)', { tag: ['@perf', '@self-hosted'] }, () => {
  test('home: product grid, then a filter click, stays within LCP, TBT and INP budgets', async ({ homePage, vitals, apiMock }) => {
    const visit = async () => {
      await expect(homePage.grid.cards.first()).toBeVisible();
      // The grid is visible before the click, so only the filter's own answer, rendered, says the click was served.
      const filtered = apiMock.waitForResponse<{ data: unknown[] }>('QUERY', '/products');
      await homePage.filters.filterByCategory(FILTER_CATEGORY);
      const { json } = await filtered;
      await expect(homePage.grid.cards).toHaveCount(json.data.length);
    };

    const measurement = await vitals.measure('home', visit);
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('search: typing a term and submitting stays within LCP, TBT and INP budgets', async ({ homePage, vitals }) => {
    const visit = async () => {
      await homePage.search.searchFor(SEARCH_TERM);
      // The caption appears only once the results have replaced the overview.
      await expect(homePage.search.caption).toHaveText(`Searched for: ${SEARCH_TERM}`);
    };

    const measurement = await vitals.measure('search', visit);
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('product page: quantity up and add to cart stays within LCP, TBT and INP budgets', async ({ productPage, vitals }) => {
    const visit = async () => {
      await productPage.increaseQuantityButton.click();
      await productPage.addToCart();
      await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();
    };

    const measurement = await vitals.measure('product', visit);
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('cart: proceeding to sign in stays within LCP, TBT and INP budgets', async ({ checkout, vitals }) => {
    const visit = async () => {
      await expect(checkout.cart.table.rows.first()).toBeVisible();
      await checkout.cart.proceed();
      await expect(checkout.signIn.loginButton).toBeVisible();
    };

    const measurement = await vitals.measure('cart', visit);
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('contact: submitting an empty form stays within LCP, TBT and INP budgets', async ({ contactPage, vitals }) => {
    const visit = async () => {
      await contactPage.submit();
      await expect(contactPage.firstName.error).toBeVisible();
    };

    const measurement = await vitals.measure('contact', visit);
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });
});

/**
 * CLS. The shop paints its footer before the routed page has its data, then pushes it down.
 * Whether a measurement catches that depends on whether the first paint beats the API, so at
 * full speed it comes and goes (0 to 0.32 across repeats). With a realistic 500 ms API latency the
 * race is decided and the shift is measured every time, which makes it a stable budget.
 */
test.describe('Layout stability on a 500 ms API (self-hosted)', { tag: ['@perf', '@self-hosted', '@bug'] }, () => {
  test.use({ apiLatencyMs: 500 });

  const SHIFTING_FOOTER = 'the footer renders at the top before the page content arrives, then jumps down (CLS 0.17 to 0.32).';

  test('home keeps its layout', async ({ homePage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    const { median, observed } = await vitals.measure('home-slow-api', () => expect(homePage.grid.cards.first()).toBeVisible(), { interactive: false });

    expect(observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expect(median.cls, 'PERF-01: CLS of home').toBeLessThanOrEqual(BUDGET.cls);
  });

  test('product page keeps its layout', async ({ productPage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    const { median, observed } = await vitals.measure('product-slow-api', () => expect(productPage.addToCartButton).toBeVisible(), { interactive: false });

    expect(observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expect(median.cls, 'PERF-01: CLS of the product page').toBeLessThanOrEqual(BUDGET.cls);
  });

  test('contact page keeps its layout', async ({ contactPage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    const { median, observed } = await vitals.measure('contact-slow-api', () => expect(contactPage.sendButton).toBeVisible(), { interactive: false });

    expect(observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expect(median.cls, 'PERF-01: CLS of the contact page').toBeLessThanOrEqual(BUDGET.cls);
  });
});

// Not a pin: the cart shifts by 0.107 against a budget of 0.1, so the same footer bug sits a hair over the line, and a
// different font render or one pixel of layout would pass it "fixed" without anyone touching the shop (a pin that can
// flip by noise cannot tell a fix from luck). It is measured, kept to its own baseline so it cannot get worse, and the
// bug stays pinned where it is unmistakable: home, product page and contact.
test.describe('Layout stability of the cart on a 500 ms API (self-hosted)', { tag: ['@perf', '@self-hosted'] }, () => {
  test.use({ apiLatencyMs: 500 });

  test('cart shows no worse a layout shift than recorded', async ({ checkout, vitals }) => {
    const measurement = await vitals.measure('cart-slow-api', () => expect(checkout.cart.table.rows.first()).toBeVisible(), { interactive: false });
    const limit = vitals.baseline(measurement, ['cls']);

    expect(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    if (limit) expect(measurement.median.cls, 'CLS of the cart against its baseline').toBeLessThanOrEqual(limit.cls!);
  });
});

import { CART_MESSAGES } from '@components/CartTable';
import { devices } from '@playwright/test';
import { expect, test } from '@fixtures';
import type { Measurement, Vitals } from '@fixtures/performance';
import { BUDGET, ceilingOf } from './limits';

/**
 * Performance budgets per key page, measured on the self-hosted Toolshop (a production build
 * served by nginx, see docker/). Live numbers would measure Cloudflare, the network and other
 * people's load, not the shop.
 *
 * What a budget means here: the browser is slowed to 4x CPU and a 40 ms, 10 Mbps connection
 * (THROTTLING in fixtures/performance.ts), and each number is the median of 5 fresh loads (5, not 3, so TBT and the INP proxy,
 * the noisiest, are not decided by one outlier load; a recording takes about a minute longer for it). The
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
 * a second limit, the median recorded in tests/performance/baseline.json for the environment (ci, or this
 * machine) plus a margin sized by the spread seen when it was recorded (see fixtures/performance.ts), which
 * catches a slide that stays inside the good range. A test never rests on that ratchet alone: the budgets (and,
 * for the cart, a fixed ceiling per metric) hold everywhere, and an environment with no recorded baseline is held to
 * them only and says so, as a test annotation and, on CI, a workflow warning.
 * Record the baseline anew after a deliberate change with `UPDATE_PERF_BASELINE=1 npm run test:perf`
 * (refused on a busy machine or from a failing run); the `ci` set comes from the record-perf-baseline workflow run.
 *
 * INP has no baseline ratchet today: every recorded INP spread (32 to 48 ms, event timing rounds to 8 ms) is wider than the margin
 * cap allows, so `vitals.baseline` leaves it out as noisy (and annotates it) and only the budget and the fixed ceiling hold it. A
 * baseline for INP needs a quieter recording, or a lower noise floor with a reason; neither is claimed here.
 *
 * This file holds the timing budgets (desktop and phone). Its neighbours: page-weight.spec.ts (bytes and requests), layout-shift.spec.ts (CLS on a
 * slow API, the PERF-01 pins and their ratchet) and collector-controls.spec.ts (the proof that the collector sees what it must). The limits they
 * share are in limits.ts.
 *
 * The perf pass is longer than it looks: each of the three slow-API pages is measured twice (5 throttled loads in its pin, 5 more in
 * its baseline ratchet, on purpose: see layout-shift.spec.ts), and `npm run test:verify-bugs` runs the pins again in a pass of their own.
 *
 * Scoped in playwright.config.ts: @perf runs in its own Chromium project, one worker and no
 * parallelism (LCP, layout-shift and longtask entries are Chromium's, and a busy CPU skews TBT
 * and INP), @self-hosted keeps it off the live site.
 */
test.use({ measureVitals: true });

/** What the scenarios filter by and search for, named once. */
const FILTER_CATEGORY = 'Pliers';
const SEARCH_TERM = 'hammer';

const RESPONSIVE_METRICS: (keyof Vitals)[] = ['lcp', 'tbt', 'inp'];

/**
 * How many clicks and key presses each scenario makes, counted the way the collector counts them (trusted `click` and `keydown`
 * events the page receives; Playwright's `fill` sends none, a click is one, and so is a press of a key). Named so a change to a
 * scenario shows up as a failing "reached the page" check instead of a quietly different measurement.
 */
const HOME_INPUTS = 1; // ticking the category checkbox
const SEARCH_INPUTS = 1; // the Search button (the term is filled, which sends no key events)
const PRODUCT_INPUTS = 2; // the quantity button, then Add to cart
const CART_INPUTS = 1; // Proceed to checkout
const CONTACT_INPUTS = 1; // Send

/**
 * Speed and responsiveness: the page is loaded, used once, and judged by what that cost. The budgets are the
 * assertion that holds everywhere; the baseline limits below them are a ratchet, applied where one is recorded.
 */
function expectResponsive({ name, median, samples, observed, inputsPerSample, expectedInputs }: Measurement, limit: Partial<Vitals> | undefined) {
  expect.soft(observed.fcpObserved, 'First Contentful Paint was observed, which opens the TBT window').toBe(true);
  expect.soft(observed.lcpEntries, 'an LCP entry was observed').toBeGreaterThan(0);
  // What the scenario declared it does is what the page received, and the browser timed an interaction out of it: a click that
  // stopped landing would leave a load that is judged as if it had been used.
  expect.soft(inputsPerSample, `every one of the ${samples.length} samples received the ${expectedInputs} click(s) and key press(es) the scenario makes`).toEqual(samples.map(() => expectedInputs));
  expect.soft(observed.interactions, 'an interaction was observed (event timing, which skips the quick ones)').toBeGreaterThan(0);
  expect.soft(observed.interactions, 'no more interactions were timed than inputs were made').toBeLessThanOrEqual(expectedInputs);
  expect.soft(observed.longTaskObserver, 'the browser reports long tasks, so a TBT of 0 was observed and not assumed').toBe(true);
  expect.soft(median.lcp, 'LCP (ms)').toBeLessThanOrEqual(BUDGET.lcp);
  expect.soft(median.tbt, 'TBT (ms)').toBeLessThanOrEqual(BUDGET.tbt);
  expect.soft(median.inp, 'INP proxy (ms)').toBeLessThanOrEqual(BUDGET.inp);
  // The fixed ceilings hold on every machine, with or without a baseline.
  expect.soft(median.lcp, `LCP (ms) against its fixed ceiling (CEILING['${name}'])`).toBeLessThanOrEqual(ceilingOf(name, 'lcp'));
  expect.soft(median.tbt, `TBT (ms) against its fixed ceiling (CEILING['${name}'])`).toBeLessThanOrEqual(ceilingOf(name, 'tbt'));
  expect.soft(median.inp, `INP proxy (ms) against its fixed ceiling (CEILING['${name}'])`).toBeLessThanOrEqual(ceilingOf(name, 'inp'));
  // The baseline ratchet, tighter, where one is recorded for this environment and a metric's recording was not too noisy to trust.
  if (limit?.lcp !== undefined) expect.soft(median.lcp, 'LCP (ms) against its baseline').toBeLessThanOrEqual(limit.lcp);
  if (limit?.tbt !== undefined) expect.soft(median.tbt, 'TBT (ms) against its baseline').toBeLessThanOrEqual(limit.tbt);
  if (limit?.inp !== undefined) expect.soft(median.inp, 'INP proxy (ms) against its baseline').toBeLessThanOrEqual(limit.inp);
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

    const measurement = await vitals.measure('home', visit, { inputs: HOME_INPUTS });
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('search: typing a term and submitting stays within LCP, TBT and INP budgets', async ({ homePage, vitals }) => {
    const visit = async () => {
      // Main content first: the blocking time of the load is counted up to the first input, and it must be the same moment on every page.
      await expect(homePage.grid.cards.first()).toBeVisible();
      await homePage.search.searchFor(SEARCH_TERM);
      // The caption appears only once the results have replaced the overview.
      await expect(homePage.search.caption).toHaveText(`Searched for: ${SEARCH_TERM}`);
    };

    const measurement = await vitals.measure('search', visit, { inputs: SEARCH_INPUTS });
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('product page: quantity up and add to cart stays within LCP, TBT and INP budgets', async ({ productPage, vitals }) => {
    const visit = async () => {
      await expect(productPage.addToCartButton).toBeVisible();
      await productPage.increaseQuantityButton.click();
      await productPage.addToCart();
      await expect(productPage.toast.message(CART_MESSAGES.added)).toBeVisible();
    };

    // A cart of its own in every sample: the add would otherwise land in a cart the earlier samples filled.
    const measurement = await vitals.measure('product', visit, { inputs: PRODUCT_INPUTS, freshCart: true });
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('cart: proceeding to sign in stays within LCP, TBT and INP budgets', async ({ checkout, vitals }) => {
    const visit = async () => {
      await expect(checkout.cart.table.rows.first()).toBeVisible();
      await checkout.cart.proceed();
      await expect(checkout.signIn.loginButton).toBeVisible();
    };

    const measurement = await vitals.measure('cart', visit, { inputs: CART_INPUTS });
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });

  test('contact: submitting an empty form stays within LCP, TBT and INP budgets', async ({ contactPage, vitals }) => {
    const visit = async () => {
      await expect(contactPage.sendButton).toBeVisible();
      await contactPage.submit();
      await expect(contactPage.firstName.error).toBeVisible();
    };

    const measurement = await vitals.measure('contact', visit, { inputs: CONTACT_INPUTS });
    expectResponsive(measurement, vitals.baseline(measurement, RESPONSIVE_METRICS));
  });
});

/**
 * The same pages on a phone: a Pixel 7 screen, touch and device pixel ratio (what playwright.config.ts's `mobile` project uses), under
 * the same 4x CPU and 10 Mbps. Only the load is judged (there is no click here: the phone's menu and the touch targets are other specs'
 * business), so the INP proxy is not asserted: the budgets are LCP and TBT, and the fixed ceilings are the ones the measurement below says.
 * A phone is what the throttling stands in for, yet the page is laid out for a desktop in the tests above: this one proves the
 * mobile layout is not slower to its main content. CLS is left to the 500 ms API runs below, which are desktop only.
 */
const { viewport: PHONE_VIEWPORT, deviceScaleFactor: PHONE_SCALE, isMobile: PHONE_IS_MOBILE, hasTouch: PHONE_HAS_TOUCH, userAgent: PHONE_USER_AGENT } = devices['Pixel 7'];

/** A load that is only looked at: it must have painted, and its main thread must not have been blocked. */
function expectLoads({ name, median, samples, observed, inputsPerSample }: Measurement, limit: Partial<Vitals> | undefined) {
  expect.soft(observed.fcpObserved, 'First Contentful Paint was observed, which opens the TBT window').toBe(true);
  expect.soft(observed.lcpEntries, 'an LCP entry was observed').toBeGreaterThan(0);
  expect.soft(inputsPerSample, `none of the ${samples.length} samples was clicked or typed into: this is a load`).toEqual(samples.map(() => 0));
  expect.soft(observed.longTaskObserver, 'the browser reports long tasks, so a TBT of 0 was observed and not assumed').toBe(true);
  expect.soft(median.lcp, 'LCP (ms)').toBeLessThanOrEqual(BUDGET.lcp);
  expect.soft(median.tbt, 'TBT (ms)').toBeLessThanOrEqual(BUDGET.tbt);
  expect.soft(median.lcp, `LCP (ms) against its fixed ceiling (CEILING['${name}'])`).toBeLessThanOrEqual(ceilingOf(name, 'lcp'));
  expect.soft(median.tbt, `TBT (ms) against its fixed ceiling (CEILING['${name}'])`).toBeLessThanOrEqual(ceilingOf(name, 'tbt'));
  if (limit?.lcp !== undefined) expect.soft(median.lcp, 'LCP (ms) against its baseline').toBeLessThanOrEqual(limit.lcp);
  if (limit?.tbt !== undefined) expect.soft(median.tbt, 'TBT (ms) against its baseline').toBeLessThanOrEqual(limit.tbt);
}

test.describe('Performance budgets on a phone (self-hosted)', { tag: ['@perf', '@self-hosted'] }, () => {
  test.use({ viewport: PHONE_VIEWPORT, deviceScaleFactor: PHONE_SCALE, isMobile: PHONE_IS_MOBILE, hasTouch: PHONE_HAS_TOUCH, userAgent: PHONE_USER_AGENT });

  test('home on a phone: the product grid is drawn within the LCP and TBT budgets', async ({ homePage, vitals }) => {
    const measurement = await vitals.measure('home-mobile', () => expect(homePage.grid.cards.first()).toBeVisible(), { inputs: 0 });

    expectLoads(measurement, vitals.baseline(measurement, ['lcp', 'tbt']));
  });

  test('product page on a phone: the add to cart button is drawn within the LCP and TBT budgets', async ({ productPage, vitals }) => {
    const measurement = await vitals.measure('product-mobile', () => expect(productPage.addToCartButton).toBeVisible(), { inputs: 0 });

    expectLoads(measurement, vitals.baseline(measurement, ['lcp', 'tbt']));
  });
});

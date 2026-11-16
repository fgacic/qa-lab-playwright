import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import type { Measurement, Vitals } from '@fixtures/performance';

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
 * for the cart, a fixed CLS ceiling) hold everywhere, and an environment with no recorded baseline is held to
 * them only and says so, as a test annotation and, on CI, a workflow warning.
 * Record the baseline anew after a deliberate change with `UPDATE_PERF_BASELINE=1 npm run test:perf`
 * (refused on a busy machine or from a failing run); the `ci` set comes from the record-perf-baseline workflow run.
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
 * The cart's fixed layout-shift ceiling, which holds with or without a baseline. The cart shifts by 0.107 in every sample
 * (the same footer bug as PERF-01, sitting a hair over the 0.1 budget), so 0.13 is that value plus about 20%: room for a font or a
 * pixel of rendering, but well under the 0.17 the same bug costs where it is unmistakable, so a cart that
 * gets visibly worse fails even on a runner whose baseline has not been committed yet.
 */
const CART_CLS_CEILING = 0.13;

/** The ratchet on layout shift, where a baseline exists: the page may not shift more than it was recorded to. */
function expectNoWorseShift(median: Vitals, limit: Partial<Vitals> | undefined, page: string) {
  if (limit) expect.soft(median.cls, `CLS of ${page} against its baseline`).toBeLessThanOrEqual(limit.cls!);
}

/**
 * Speed and responsiveness: the page is loaded, used once, and judged by what that cost. The budgets are the
 * assertion that holds everywhere; the baseline limits below them are a ratchet, applied where one is recorded.
 */
function expectResponsive({ median, observed, expectedInputs }: Measurement, limit: Partial<Vitals> | undefined) {
  expect.soft(observed.lcpEntries, 'an LCP entry was observed').toBeGreaterThan(0);
  // What the scenario declared it does is what the page received, and the browser timed an interaction out of it: a click that
  // stopped landing would leave a load that is judged as if it had been used.
  expect.soft(observed.inputs, 'the clicks and key presses the scenario makes reached the page').toBe(expectedInputs);
  expect.soft(observed.interactions, 'an interaction was observed (event timing, which skips the quick ones)').toBeGreaterThan(0);
  expect.soft(observed.interactions, 'no more interactions were timed than inputs were made').toBeLessThanOrEqual(observed.inputs);
  expect.soft(observed.longTaskObserver, 'the browser reports long tasks, so a TBT of 0 was observed and not assumed').toBe(true);
  expect.soft(median.lcp, 'LCP (ms)').toBeLessThanOrEqual(BUDGET.lcp);
  expect.soft(median.tbt, 'TBT (ms)').toBeLessThanOrEqual(BUDGET.tbt);
  expect.soft(median.inp, 'INP proxy (ms)').toBeLessThanOrEqual(BUDGET.inp);
  if (!limit) return; // no baseline for this environment: vitals.baseline annotated (and, on CI, warned); the budgets above still hold
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
      await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();
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
 * CLS. The shop paints its footer before the routed page has its data, then pushes it down.
 * Whether a measurement catches that depends on whether the first paint beats the API, so at
 * full speed it comes and goes (0 to 0.32 across repeats). With a realistic 500 ms API latency the
 * race is decided and the shift is measured every time, which makes it a stable budget.
 *
 * Two kinds of test sit on it, kept apart: the pin states the budget the shop should meet (and fails today, as expected),
 * and the ratchet, a passing test, holds the shift to its own recorded baseline so a pinned page cannot get worse unseen. They
 * are separate tests because a baseline is only ever recorded from a test that passed, and a pin never does.
 */
const SHIFTING_FOOTER = 'the footer renders at the top before the page content arrives, then jumps down (CLS 0.17 to 0.38).';

test.describe('Layout stability on a 500 ms API (self-hosted)', { tag: ['@perf', '@self-hosted', '@bug'] }, () => {
  test.use({ apiLatencyMs: 500 });

  test('home keeps its layout', async ({ homePage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    const { median, observed } = await vitals.measure('home-slow-api', () => expect(homePage.grid.cards.first()).toBeVisible(), { inputs: 0 });

    // Precondition, true whether or not the bug is fixed: the page painted.
    expect(observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expect(median.cls, 'PERF-01: CLS of home').toBeLessThanOrEqual(BUDGET.cls);
  });

  test('product page keeps its layout', async ({ productPage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    const { median, observed } = await vitals.measure('product-slow-api', () => expect(productPage.addToCartButton).toBeVisible(), { inputs: 0 });

    expect(observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expect(median.cls, 'PERF-01: CLS of the product page').toBeLessThanOrEqual(BUDGET.cls);
  });

  test('contact page keeps its layout', async ({ contactPage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    const { median, observed } = await vitals.measure('contact-slow-api', () => expect(contactPage.sendButton).toBeVisible(), { inputs: 0 });

    expect(observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expect(median.cls, 'PERF-01: CLS of the contact page').toBeLessThanOrEqual(BUDGET.cls);
  });
});

// The pinned pages hold their recorded shift. Not pins: the pin above says "over 0.1", so on its own a footer that jumped further
// would pass unseen. Measured under the same 500 ms API, so these are the baselines of the same three measurements.
test.describe('Layout shift of the pinned pages against their baseline, on a 500 ms API (self-hosted)', { tag: ['@perf', '@self-hosted'] }, () => {
  test.use({ apiLatencyMs: 500 });

  test('home shifts no more than its recorded baseline', async ({ homePage, vitals }) => {
    const measurement = await vitals.measure('home-slow-api', () => expect(homePage.grid.cards.first()).toBeVisible(), { inputs: 0 });

    expect.soft(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expectNoWorseShift(measurement.median, vitals.baseline(measurement, ['cls']), 'home');
  });

  test('product page shifts no more than its recorded baseline', async ({ productPage, vitals }) => {
    const measurement = await vitals.measure('product-slow-api', () => expect(productPage.addToCartButton).toBeVisible(), { inputs: 0 });

    expect.soft(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expectNoWorseShift(measurement.median, vitals.baseline(measurement, ['cls']), 'the product page');
  });

  test('contact page shifts no more than its recorded baseline', async ({ contactPage, vitals }) => {
    const measurement = await vitals.measure('contact-slow-api', () => expect(contactPage.sendButton).toBeVisible(), { inputs: 0 });

    expect.soft(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expectNoWorseShift(measurement.median, vitals.baseline(measurement, ['cls']), 'the contact page');
  });
});

// Not a pin: the cart shifts by 0.107 against a budget of 0.1, so the same footer bug sits a hair over the line, and a
// different font render or one pixel of layout would pass it "fixed" without anyone touching the shop (a pin that can
// flip by noise cannot tell a fix from luck). It is measured, kept to its own baseline so it cannot get worse, and the
// bug stays pinned where it is unmistakable: home, product page and contact. Its fixed ceiling holds everywhere; the baseline
// ratchet is tighter, where one is recorded.
test.describe('Layout stability of the cart on a 500 ms API (self-hosted)', { tag: ['@perf', '@self-hosted'] }, () => {
  test.use({ apiLatencyMs: 500 });

  test('cart shows no worse a layout shift than its ceiling and its recorded baseline', async ({ checkout, vitals }) => {
    const measurement = await vitals.measure('cart-slow-api', () => expect(checkout.cart.table.rows.first()).toBeVisible(), { inputs: 0 });
    const limit = vitals.baseline(measurement, ['cls']);

    expect.soft(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    // The ceiling holds on every environment; the baseline, where recorded, is the tighter ratchet under it.
    expect.soft(measurement.median.cls, `CLS of the cart against its fixed ceiling (see CART_CLS_CEILING)`).toBeLessThanOrEqual(CART_CLS_CEILING);
    expectNoWorseShift(measurement.median, limit, 'the cart');
  });
});

/**
 * Control for the collector. A TBT of 0 is the normal result, so on its own it cannot be told from a collector that
 * sees no long tasks. Here a known long task is run before any interaction and must be counted: that proves the observer is
 * alive in this browser, which is what gives the zeros above their meaning.
 */
test.describe('Performance collector (control)', { tag: ['@perf', '@self-hosted'] }, () => {
  const BLOCKING_MS = 150;
  /** Blocking time is a task's length above 50 ms, so a 150 ms task must add at least 100 ms. */
  const EXPECTED_TBT = BLOCKING_MS - 50;

  test('counts a known long task as blocking time', async ({ homePage, vitals }) => {
    // Run from a timer, i.e. as a task of the page's own event loop: a script evaluated over the debugging protocol is not
    // reported as a long task, so blocking inside evaluate() itself would leave the observer with nothing to count.
    const block = (ms: number) =>
      homePage.page.evaluate(
        (duration) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              const end = performance.now() + duration;
              while (performance.now() < end);
              resolve();
            }, 0),
          ),
        ms,
      );

    const { median, observed } = await vitals.measure('long-task-control', () => block(BLOCKING_MS), { inputs: 0, samples: 3 });

    expect(observed.longTaskObserver, 'the browser reports long tasks').toBe(true);
    expect(median.tbt, `a ${BLOCKING_MS} ms task counted as blocking time (ms)`).toBeGreaterThanOrEqual(EXPECTED_TBT);
  });
});

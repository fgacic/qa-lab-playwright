import { devices } from '@playwright/test';
import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { measurePageWeight } from '@support/page-weight';
import { slowEveryClick } from '@support/slow-click';
import { onCI, type Measurement, type Vitals } from '@fixtures/performance';
import baseline from './baseline.json';

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
 * The perf pass is longer than it looks: each of the three slow-API pages is measured twice (5 throttled loads in its pin, 5 more in
 * its baseline ratchet, on purpose: see below), and `npm run test:verify-bugs` runs the pins again in a pass of their own.
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
 * How much slower than this machine a CI runner may be before a fixed ceiling is tripped: the time metrics (LCP, TBT, INP) are
 * scaled by it on CI, until a `ci` baseline is recorded and committed (a shared runner is not a laptop, and no number measured on a
 * runner exists yet to derive a ceiling from). It is not applied to CLS: a layout shift is the race between first paint and the
 * API, decided by the throttled network and the 500 ms latency we set, not by how fast the CPU is. A scaled ceiling never goes
 * above the budget (the budget is the limit that holds everywhere), so on CI the LCP ceilings meet it.
 *
 * It ends by itself: the day tests/performance/baseline.json holds a `ci` set (the record-perf-baseline workflow's artifact, committed),
 * the factor is 1 and the baseline ratchet is what holds a CI run, so this loosening cannot outlive the reason it exists.
 */
const HAS_CI_BASELINE = 'ci' in baseline;
const CI_SLOWDOWN = onCI() && !HAS_CI_BASELINE ? 1.5 : 1;
const scaled = (ms: number, budget: number) => Math.min(Math.round(ms * CI_SLOWDOWN), budget);

/**
 * Fixed ceilings, one per measurement, that hold on every machine with or without a recorded baseline. The CI baseline cannot be
 * recorded without a push, so on a runner these are what makes a perf test mean more than "inside Google's good limits".
 * Each is derived from the values recorded on an idle machine (tests/performance/baseline.json) with the margin stated here;
 * the time metrics are scaled on CI (CI_SLOWDOWN):
 * - LCP: the recorded median times 1.5, rounded up to 50 ms, and well under the 2 500 ms budget. Recorded medians (baseline.json): home 1 224,
 *   search 1 224, product 1 264, cart 1 048, contact 1 044 ms; on a phone (the same throttling, no click) home 1 216, product 1 260 ms.
 * - TBT: 100 ms, half the 200 ms budget and twice the 50 ms noise floor. Recorded 0 on every page: the shop does not block the
 *   main thread under 4x throttling, and a 100 ms block is a real regression, not noise.
 * - INP proxy: 80 ms, 2.5 times the highest recorded median (32 ms, search; the others 16 to 24 ms, and event timing is rounded to 8 ms, so
 *   one step of it moves a median by a quarter) and well under half the 200 ms budget. The
 *   recorded INP spreads (32 to 48 ms) are all wider than the baseline's cap allows (see isNoisy in fixtures/performance.ts), so
 *   INP has no baseline ratchet at all today: this ceiling and the budget are the only limits on it.
 * - On CI (CI_SLOWDOWN 1.5, never above the budget) the effective ceilings are: LCP 2 500 ms for home, search and product (their scaled
 *   value is over the budget, so the budget is the ceiling) and 2 400 ms for cart and contact; TBT 150 ms; INP proxy 120 ms; CLS as below, unscaled.
 * - CLS, on the slow API: the recorded median plus about 20%, rounded up to 0.01 (recorded: home 0.258, product 0.316 with a
 *   spread of 0.082 (the race between first paint and the API), contact 0.17, cart 0.107).
 */
const CEILING: Record<string, Partial<Vitals>> = {
  home: { lcp: scaled(1_900, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  search: { lcp: scaled(1_900, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  product: { lcp: scaled(1_950, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  cart: { lcp: scaled(1_600, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  contact: { lcp: scaled(1_600, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  'home-mobile': { lcp: scaled(1_850, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt) },
  'product-mobile': { lcp: scaled(1_900, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt) },
  'home-slow-api': { cls: 0.31 },
  'product-slow-api': { cls: 0.38 },
  'contact-slow-api': { cls: 0.21 },
  // The cart shifts by 0.107 in every sample (the same footer bug as PERF-01, a hair over the 0.1 budget): 0.13 is that plus about 20%,
  // room for a font or a pixel of rendering, well under the 0.17 the bug costs where it is unmistakable.
  'cart-slow-api': { cls: 0.13 },
};

/** The fixed ceiling of one metric of a measurement, or an error that names the missing entry (a new scenario must come with its ceilings). */
function ceilingOf(name: string, metric: keyof Vitals): number {
  const ceiling = CEILING[name]?.[metric];
  if (ceiling === undefined) throw new Error(`No fixed ceiling for ${name}.${metric}: add it to CEILING (with the measured value it is derived from).`);
  return ceiling;
}

/**
 * The layout-shift limits of a pinned page: the fixed ceiling holds everywhere, and the baseline, where one is recorded and not
 * noisy, is the tighter ratchet under it, so a footer that jumps further cannot pass unseen.
 */
function expectNoWorseShift({ name, median }: Measurement, limit: Partial<Vitals> | undefined, page: string) {
  expect.soft(median.cls, `CLS of ${page} against its fixed ceiling (CEILING['${name}'])`).toBeLessThanOrEqual(ceilingOf(name, 'cls'));
  if (limit?.cls !== undefined) expect.soft(median.cls, `CLS of ${page} against its baseline`).toBeLessThanOrEqual(limit.cls);
}

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

/**
 * What a first visit downloads. A budget on the bytes and the requests is a limit the timing budgets above do not give: a doubled bundle
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

test.describe('Page weight (self-hosted)', { tag: ['@perf', '@self-hosted'] }, () => {
  // No collector and no throttling: the bytes do not depend on speed, and a throttled load would only make the test slower.
  test.use({ measureVitals: false });

  test('home: the first load stays within its byte and request budget', async ({ homePage }) => {
    const start = homePage.page.url();

    const weight = await measurePageWeight(homePage.page, async () => {
      await homePage.page.goto(start, { waitUntil: 'load' });
      await expect(homePage.grid.cards.first()).toBeVisible();
    });

    expect.soft(weight.requests, 'requests made (a load that made none measured nothing)').toBeGreaterThan(0);
    expect.soft(weight.bytes, `bytes received; the heaviest: ${weight.heaviest.map(({ url, bytes }) => `${url} ${bytes}`).join(', ')}`).toBeLessThanOrEqual(WEIGHT_CEILING.home.bytes);
    expect.soft(weight.requests, 'requests made').toBeLessThanOrEqual(WEIGHT_CEILING.home.requests);
    expect.soft(weight.scriptBytes, 'script bytes received').toBeLessThanOrEqual(WEIGHT_CEILING.home.scriptBytes);
  });

  test('product page: the first load stays within its byte and request budget', async ({ productPage }) => {
    const start = productPage.page.url();

    const weight = await measurePageWeight(productPage.page, async () => {
      await productPage.page.goto(start, { waitUntil: 'load' });
      await expect(productPage.addToCartButton).toBeVisible();
    });

    expect.soft(weight.requests, 'requests made (a load that made none measured nothing)').toBeGreaterThan(0);
    expect.soft(weight.bytes, `bytes received; the heaviest: ${weight.heaviest.map(({ url, bytes }) => `${url} ${bytes}`).join(', ')}`).toBeLessThanOrEqual(WEIGHT_CEILING.product.bytes);
    expect.soft(weight.requests, 'requests made').toBeLessThanOrEqual(WEIGHT_CEILING.product.requests);
    expect.soft(weight.scriptBytes, 'script bytes received').toBeLessThanOrEqual(WEIGHT_CEILING.product.scriptBytes);
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
    expectNoWorseShift(measurement, vitals.baseline(measurement, ['cls']), 'home');
  });

  test('product page shifts no more than its recorded baseline', async ({ productPage, vitals }) => {
    const measurement = await vitals.measure('product-slow-api', () => expect(productPage.addToCartButton).toBeVisible(), { inputs: 0 });

    expect.soft(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expectNoWorseShift(measurement, vitals.baseline(measurement, ['cls']), 'the product page');
  });

  test('contact page shifts no more than its recorded baseline', async ({ contactPage, vitals }) => {
    const measurement = await vitals.measure('contact-slow-api', () => expect(contactPage.sendButton).toBeVisible(), { inputs: 0 });

    expect.soft(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    expectNoWorseShift(measurement, vitals.baseline(measurement, ['cls']), 'the contact page');
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

    expect.soft(measurement.observed.lcpEntries, 'the page painted').toBeGreaterThan(0);
    // The ceiling holds on every environment; the baseline, where recorded, is the tighter ratchet under it.
    expectNoWorseShift(measurement, vitals.baseline(measurement, ['cls']), 'the cart');
  });
});

/**
 * Controls for the collector. A TBT of 0 is the normal result, so on its own it cannot be told from a collector that
 * sees no long tasks, and the shop's quick INP cannot be told from one that sees no interactions. Here a known long task and a known
 * slow click are run and must be counted: that proves the observers are alive in this browser, which is what gives the small numbers
 * above their meaning.
 */
test.describe('Performance collector (control)', { tag: ['@perf', '@self-hosted'] }, () => {
  const BLOCKING_MS = 150;
  /** Blocking time is a task's length above 50 ms, so a 150 ms task must add at least 100 ms. */
  const EXPECTED_TBT = BLOCKING_MS - 50;

  test('counts a known long task as blocking time', async ({ homePage, vitals }) => {
    // After the first paint: blocking time is counted from First Contentful Paint on, so the task must start once the page has drawn.
    const block = async () => {
      await expect(homePage.grid.cards.first()).toBeVisible();
      await vitals.blockMainThread(BLOCKING_MS);
    };

    const { median, observed } = await vitals.measure('long-task-control', block, { inputs: 0, samples: 3 });

    expect(observed.longTaskObserver, 'the browser reports long tasks').toBe(true);
    expect(median.tbt, `a ${BLOCKING_MS} ms task counted as blocking time (ms)`).toBeGreaterThanOrEqual(EXPECTED_TBT);
  });

  /** The click's handler blocks for this long, and the interaction takes at least that long to reach the next paint. */
  const SLOW_CLICK_MS = 300;
  /** Event timing rounds a duration to 8 ms, so a 300 ms handler may be reported as 296. */
  const EVENT_TIMING_ROUNDING_MS = 8;

  test('counts a known slow click as the interaction time', async ({ homePage, vitals }) => {
    await slowEveryClick(homePage.page, SLOW_CLICK_MS);
    const click = async () => {
      await expect(homePage.banner).toBeVisible();
      await homePage.banner.click();
    };

    const { median, observed, inputsPerSample } = await vitals.measure('slow-click-control', click, { inputs: 1, samples: 3 });

    expect(inputsPerSample, 'every sample received its click').toEqual([1, 1, 1]);
    expect(observed.interactions, 'the browser timed the click as an interaction').toBeGreaterThan(0);
    expect(median.inp, `a click that blocks for ${SLOW_CLICK_MS} ms counted as interaction time (ms)`).toBeGreaterThanOrEqual(SLOW_CLICK_MS - EVENT_TIMING_ROUNDING_MS);
    expect(median.inp, 'and it is over the INP budget, which is what the budgets exist to catch').toBeGreaterThan(BUDGET.inp);
  });

  /** The control for the page-weight budget: a document of a known size, served by a route, must be counted in bytes, as a request and as a non-script. */
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

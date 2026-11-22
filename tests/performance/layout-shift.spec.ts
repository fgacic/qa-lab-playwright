import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { BUDGET, expectNoWorseShift } from './limits';

/** Layout stability: the PERF-01 pins, their baseline ratchet and the cart, all on a 500 ms API. Budgets and ceilings: limits.ts; the method: budgets.spec.ts. */
test.use({ measureVitals: true });

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

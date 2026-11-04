import { expect, test } from '@fixtures';
import { IS_SELF_HOSTED, SELF_HOSTED_ONLY } from '@support/env';
import { knownBug } from '@support/known-bug';
import type { Vitals } from '../../fixtures/performance';

/**
 * Performance budgets per key page, measured on the self-hosted Toolshop (a production build
 * served by nginx, see docker/). Live numbers would measure Cloudflare, the network and other
 * people's load, not the shop.
 *
 * Thresholds are Google's Core Web Vitals "good" limits (web.dev/articles/vitals): LCP 2.5 s,
 * CLS 0.1, INP 200 ms; TBT, the lab stand-in for INP during load, uses Lighthouse's 200 ms
 * "good" limit. Measured values are attached to every test and listed in docs/COVERAGE.md.
 */
test.skip(!IS_SELF_HOSTED, SELF_HOSTED_ONLY);
test.skip(({ browserName }) => browserName !== 'chromium', 'LCP, layout-shift and longtask entries exist in Chromium only.');
test.use({ measureVitals: true });

const BUDGET: Vitals = { lcp: 2_500, cls: 0.1, tbt: 200, inp: 200 };

function expectResponsive(measured: Vitals) {
  expect.soft(measured.lcp, 'LCP (ms)').toBeLessThanOrEqual(BUDGET.lcp);
  expect.soft(measured.tbt, 'TBT (ms)').toBeLessThanOrEqual(BUDGET.tbt);
  expect.soft(measured.inp, 'INP proxy (ms)').toBeLessThanOrEqual(BUDGET.inp);
}

/**
 * Speed and responsiveness at the container's normal speed. Layout stability is tested apart,
 * below: it depends on a race and needs a controlled network to measure reliably.
 */
test.describe('Performance budgets (self-hosted)', { tag: ['@perf'] }, () => {
  test.describe('home: product grid, then a filter click', () => {
    const visit = async (homePage: import('@pages/HomePage').HomePage) => {
      await expect(homePage.grid.cards.first()).toBeVisible();
      await homePage.filters.filterByCategory('Pliers');
      await expect(homePage.grid.cards.first()).toBeVisible();
    };
    test('LCP, TBT and INP within budget', async ({ homePage, vitals }) => {
      await visit(homePage);
      expectResponsive(await vitals.read('home'));
    });
  });

  test.describe('search: typing a term and submitting', () => {
    const visit = async (homePage: import('@pages/HomePage').HomePage) => {
      await homePage.search.searchFor('hammer');
      await expect(homePage.grid.cards.first()).toBeVisible();
    };
    test('LCP, TBT and INP within budget', async ({ homePage, vitals }) => {
      await visit(homePage);
      expectResponsive(await vitals.read('search'));
    });
  });

  test.describe('product page: quantity up and add to cart', () => {
    const visit = async (productPage: import('@pages/ProductPage').ProductPage) => {
      await productPage.increaseQuantityButton.click();
      await productPage.addToCart();
      await expect(productPage.toast.message('Product added to shopping cart.')).toBeVisible();
    };
    test('LCP, TBT and INP within budget', async ({ productPage, vitals }) => {
      await visit(productPage);
      expectResponsive(await vitals.read('product'));
    });
  });

  test.describe('cart: proceeding to sign in', () => {
    const visit = async (checkout: import('@pages/CheckoutPage').CheckoutPage) => {
      await expect(checkout.cart.table.rows.first()).toBeVisible();
      await checkout.cart.proceed();
      await expect(checkout.signIn.loginButton).toBeVisible();
    };
    test('LCP, TBT and INP within budget', async ({ checkout, vitals }) => {
      await visit(checkout);
      expectResponsive(await vitals.read('cart'));
    });
  });

  test.describe('contact: submitting an empty form', () => {
    const visit = async (contactPage: import('@pages/ContactPage').ContactPage) => {
      await contactPage.submit();
      await expect(contactPage.firstName.error).toBeVisible();
    };
    test('LCP, TBT and INP within budget', async ({ contactPage, vitals }) => {
      await visit(contactPage);
      expectResponsive(await vitals.read('contact'));
    });
  });
});

/**
 * CLS. The shop paints its footer before the routed page has its data, then pushes it down.
 * Whether a measurement catches that depends on whether the first paint beats the API, so at
 * full speed it comes and goes (0 to 0.32 across repeats). With a realistic 500 ms API latency the
 * race is decided and the shift is measured every time, which makes it a stable budget.
 */
test.describe('Layout stability on a 500 ms API (self-hosted)', { tag: ['@perf'] }, () => {
  test.use({ apiLatencyMs: 500 });

  const SHIFTING_FOOTER = 'the footer renders at the top before the page content arrives, then jumps down (CLS 0.17 to 0.32).';

  test('home keeps its layout', async ({ homePage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    await expect(homePage.grid.cards.first()).toBeVisible();
    expect((await vitals.read('home-slow-api')).cls, 'CLS').toBeLessThanOrEqual(BUDGET.cls);
  });

  test('product page keeps its layout', async ({ productPage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    await expect(productPage.addToCartButton).toBeVisible();
    expect((await vitals.read('product-slow-api')).cls, 'CLS').toBeLessThanOrEqual(BUDGET.cls);
  });

  test('cart keeps its layout', async ({ checkout, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    await expect(checkout.cart.table.rows.first()).toBeVisible();
    expect((await vitals.read('cart-slow-api')).cls, 'CLS').toBeLessThanOrEqual(BUDGET.cls);
  });

  test('contact page keeps its layout', async ({ contactPage, vitals }) => {
    knownBug('PERF-01', SHIFTING_FOOTER);
    await expect(contactPage.sendButton).toBeVisible();
    expect((await vitals.read('contact-slow-api')).cls, 'CLS').toBeLessThanOrEqual(BUDGET.cls);
  });
});

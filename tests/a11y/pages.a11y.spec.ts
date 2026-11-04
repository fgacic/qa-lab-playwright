import fs from 'node:fs';
import { expect, mock, test, withMocks } from '@fixtures';
import type { A11yScan } from '../../fixtures/a11y';
import { KNOWN_VIOLATIONS } from '@support/a11y-baseline';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * An axe scan (WCAG 2.2 A and AA) of every public page and key state, plus the account and
 * admin pages under their mocked sessions. A scan fails only on a violation that is not in the
 * known baseline (src/support/a11y-baseline.ts): it catches regressions; known-violations.a11y
 * pins each known one so it turns red when fixed.
 *
 * @axe: Chromium only (playwright.config.ts). axe reads the accessibility tree the browser builds
 * and engines differ in edge cases (Firefox does not report AX-01), so the baseline is kept for one.
 */
async function expectNoNewViolations(scan: A11yScan, page: string): Promise<void> {
  // A11Y_RECORD=<file> appends every finding as JSON lines: how the baseline is (re)built.
  if (process.env.A11Y_RECORD) {
    for (const finding of scan.findings) fs.appendFileSync(process.env.A11Y_RECORD, JSON.stringify({ page, ...finding }) + '\n');
    return;
  }
  const known = (f: { rule: string; target: string }) => KNOWN_VIOLATIONS.some((k) => k.rule === f.rule && k.target === f.target);
  const unexpected = scan.findings.filter((f) => !known(f)).map((f) => `${f.rule} (${f.impact}) on ${f.target}`);
  expect(unexpected, `new accessibility violations on ${page}`).toEqual([]);
}

test.describe('Accessibility scan: shop', { tag: ['@a11y', '@axe'] }, () => {
  test('home', async ({ homePage, a11y }) => {
    await expect(homePage.grid.cards.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('home'), 'home');
  });

  test('search results', async ({ homePage, a11y }) => {
    await homePage.search.searchFor('pliers');
    await expect(homePage.grid.cards.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('search-results'), 'search results');
  });

  test('search without results', async ({ homePage, a11y }) => {
    await homePage.search.searchFor('qa-lab-no-such-product');
    await expect(homePage.grid.emptyState).toBeVisible();
    await expectNoNewViolations(await a11y.scan('search-empty'), 'search without results');
  });

  test('product in stock', async ({ productPage, a11y }) => {
    await expect(productPage.relatedProducts.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('product'), 'product');
  });

  test.describe('out of stock', () => {
    test.use({ productKind: 'out-of-stock' });

    test('product out of stock', async ({ productPage, a11y }) => {
      await expect(productPage.outOfStock).toBeVisible();
      await expectNoNewViolations(await a11y.scan('product-out-of-stock'), 'product out of stock');
    });
  });

  test('category page', async ({ categoryPage, a11y }) => {
    await categoryPage.open('hand-tools');
    await expect(categoryPage.grid.cards.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('category'), 'category');
  });

  test('rentals', async ({ rentalsPage, a11y }) => {
    await expect(rentalsPage.grid.cards.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('rentals'), 'rentals');
  });

  test.describe('comparison', () => {
    test.use({ comparedProducts: async ({ catalog }, use) => use([await catalog.inStock(), await catalog.outOfStock()]) });

    test('comparison', async ({ comparisonPage, a11y }) => {
      await expect(comparisonPage.productColumns).toHaveCount(2);
      await expectNoNewViolations(await a11y.scan('comparison'), 'comparison');
    });
  });

  test('cart with items', async ({ checkout, a11y }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expectNoNewViolations(await a11y.scan('cart'), 'cart');
  });

  test('checkout: sign in, guest, billing and payment steps', async ({ checkout, a11y }) => {
    await checkout.cart.proceed();
    await expect(checkout.signIn.loginButton).toBeVisible();
    await expectNoNewViolations(await a11y.scan('checkout-sign-in'), 'checkout sign-in');

    await checkout.signIn.guestTab.click();
    await checkout.signIn.continueAsGuestButton.click();
    await expect(checkout.signIn.guestEmail.error).toBeVisible();
    await expectNoNewViolations(await a11y.scan('checkout-guest-errors'), 'checkout guest with errors');

    await checkout.signIn.continueAsGuest(fakeGuest());
    await expect(checkout.billing.heading).toBeVisible();
    await expectNoNewViolations(await a11y.scan('checkout-billing'), 'checkout billing');

    await checkout.billing.enterAddress(fakeAddress());
    await checkout.billing.proceed();
    await checkout.payment.choose('credit-card');
    await expectNoNewViolations(await a11y.scan('checkout-payment'), 'checkout payment');
  });

  test('login with errors', async ({ loginPage, a11y }) => {
    await loginPage.loginButton.click();
    await expect(loginPage.email.error).toBeVisible();
    await expectNoNewViolations(await a11y.scan('login-errors'), 'login with errors');
  });

  test('registration with errors', async ({ registerPage, a11y }) => {
    await registerPage.submit();
    await expect(registerPage.firstName.error).toBeVisible();
    await expectNoNewViolations(await a11y.scan('register-errors'), 'register with errors');
  });

  test('forgot password', async ({ forgotPasswordPage, a11y }) => {
    await expect(forgotPasswordPage.heading).toBeVisible();
    await expectNoNewViolations(await a11y.scan('forgot-password'), 'forgot password');
  });

  test('contact with errors', async ({ contactPage, a11y }) => {
    await contactPage.submit();
    await expect(contactPage.firstName.error).toBeVisible();
    await expectNoNewViolations(await a11y.scan('contact-errors'), 'contact with errors');
  });

  test('chat open', async ({ homePage, a11y }) => {
    await homePage.shell.chat.open();
    await expect(homePage.shell.chat.greeting).toBeVisible();
    await expectNoNewViolations(await a11y.scan('chat-open'), 'chat open');
  });

  test('privacy policy', async ({ homePage, a11y, page }) => {
    await homePage.shell.footer.openPrivacyPolicy();
    await expect(page).toHaveURL('/privacy');
    await expectNoNewViolations(await a11y.scan('privacy'), 'privacy policy');
  });

  test('unknown route', async ({ page, a11y }) => {
    // There is no 404 page: an unknown route redirects home (see BUG-02). The scan covers what renders.
    await page.goto('/this/route/does/not/exist', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/');
    await expectNoNewViolations(await a11y.scan('unknown-route'), 'unknown route');
  });
});

test.describe('Accessibility scan: account (mocked session)', { tag: ['@a11y', '@axe', '@mocked'] }, () => {
  test.use(withMocks(
    mock.respond('GET', '/favorites', []),
    mock.respond('GET', '/invoices', { current_page: 1, data: [], last_page: 1, total: 0, per_page: 15 }),
    mock.respond('GET', '/messages', { current_page: 1, data: [], last_page: 1, total: 0, per_page: 15 }),
    mock.respond('POST', '/totp/setup', {}),
  ));

  test('account page', async ({ accountPage, a11y }) => {
    await expect(accountPage.title).toBeVisible();
    await expectNoNewViolations(await a11y.scan('account'), 'account');
  });

  test('favorites', async ({ favoritesPage, a11y }) => {
    await expect(favoritesPage.emptyState).toBeVisible();
    await expectNoNewViolations(await a11y.scan('account-favorites'), 'account favorites');
  });

  test('invoices', async ({ invoicesPage, a11y }) => {
    await expect(invoicesPage.title).toBeVisible();
    await expectNoNewViolations(await a11y.scan('account-invoices'), 'account invoices');
  });

  test('messages', async ({ messagesPage, a11y }) => {
    await expect(messagesPage.emptyState).toBeVisible();
    await expectNoNewViolations(await a11y.scan('account-messages'), 'account messages');
  });

  test('profile', async ({ profilePage, a11y }) => {
    await expect(profilePage.firstName.input).toBeVisible();
    await expectNoNewViolations(await a11y.scan('account-profile'), 'account profile');
  });
});

test.describe('Accessibility scan: back office (mocked admin)', { tag: ['@a11y', '@axe', '@mocked'] }, () => {
  test('dashboard', async ({ adminDashboard, a11y }) => {
    await expect(adminDashboard.salesChart).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-dashboard'), 'admin dashboard');
  });

  test('products list and product form', async ({ adminProducts, backOffice, a11y }) => {
    await expect(adminProducts.table.rows.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-products'), 'admin products');

    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    await expectNoNewViolations(await a11y.scan('admin-product-form'), 'admin product form');
  });

  test('brands and the brand form with errors', async ({ adminBrands, a11y }) => {
    await expect(adminBrands.table.rows.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-brands'), 'admin brands');

    const form = await adminBrands.add();
    await form.chrome.save();
    await expect(form.name.error).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-brand-form'), 'admin brand form');
  });

  test('categories', async ({ adminCategories, a11y }) => {
    await expect(adminCategories.table.rows.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-categories'), 'admin categories');
  });

  test('orders and an order', async ({ adminOrders, backOffice, a11y }) => {
    await expect(adminOrders.table.rows.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-orders'), 'admin orders');

    const order = await adminOrders.edit(backOffice.order.invoice_number);
    await expect(order.lines.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-order'), 'admin order');
  });

  test('users and the user form', async ({ adminUsers, a11y }) => {
    await expect(adminUsers.table.rows.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-users'), 'admin users');

    const form = await adminUsers.edit('testy.mctestface@example.com');
    await expect(form.email).not.toBeEmpty();
    await expectNoNewViolations(await a11y.scan('admin-user-form'), 'admin user form');
  });

  test('messages and a message', async ({ adminMessages, a11y }) => {
    await expect(adminMessages.table.rows.first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-messages'), 'admin messages');

    const message = await adminMessages.details('Testy McTestface');
    await expect(message.replyBox).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-message'), 'admin message');
  });

  test('statistics', async ({ adminStatistics, a11y }) => {
    await expect(adminStatistics.report('Customers By Country').first()).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-statistics'), 'admin statistics');
  });

  test('average sales report', async ({ adminMonthlySales, a11y }) => {
    await expect(adminMonthlySales.chart).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-sales-report'), 'admin sales report');
  });

  test('settings', async ({ adminSettings, a11y }) => {
    await expect(adminSettings.paymentEndpoint).toBeVisible();
    await expectNoNewViolations(await a11y.scan('admin-settings'), 'admin settings');
  });
});

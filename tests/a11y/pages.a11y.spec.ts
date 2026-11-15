import fs from 'node:fs';
import { expect, mock, test, withMocks } from '@fixtures';
import type { A11yScan } from '@fixtures/a11y';
import { customer } from '@support/admin-payloads';
import { KNOWN_VIOLATIONS, type ScanName } from '@support/a11y-baseline';
import { IS_SELF_HOSTED } from '@support/env';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * An axe scan (WCAG 2.2 A and AA) of every public page and key state, plus the account and
 * admin pages under their mocked sessions. A scan fails on a violation that is not in the known
 * baseline (src/support/a11y-baseline.ts), and on a known one that spread, shrank or is gone from
 * a page it was recorded on, so the baseline is a ratchet that moves with every fix;
 * known-violations.a11y pins each known one so it turns red when fixed.
 *
 * Every scan names its state (a `ScanName`, shared with the baseline) and lists the content that
 * state draws last in `ready`: the scan fixture waits for each before axe reads the page.
 *
 * @axe: Chromium only (playwright.config.ts). axe reads the accessibility tree the browser builds
 * and engines differ in edge cases (Firefox does not report AX-01), so the baseline is kept for one.
 */
async function expectNoNewViolations(scan: A11yScan, page: ScanName): Promise<void> {
  // A11Y_RECORD=<file> appends every finding as JSON lines: how the baseline is (re)built.
  if (process.env.A11Y_RECORD) {
    // A recording is a deliberate local act: on CI it would turn every violation into "known".
    if (process.env.CI) throw new Error('A11Y_RECORD is for rebuilding the baseline locally; it refuses to run when CI is set.');
    for (const finding of scan.findings) fs.appendFileSync(process.env.A11Y_RECORD, JSON.stringify({ page, ...finding }) + '\n');
    return;
  }
  // A known violation is known on the pages it was recorded on, and for exactly as many elements as it was recorded with:
  // more is a spread (a new violation), fewer is a fix the baseline must record.
  // Elements counted from the shop's seed data are compared exactly only on the self-hosted shop, whose seed is fixed (KnownViolation.seedDependent).
  const problems = scan.findings.flatMap((f) => {
    const known = KNOWN_VIOLATIONS.find((k) => k.rule === f.rule && k.target === f.target && k.pages.includes(page));
    if (!known) return [`${f.rule} (${f.impact}) on ${f.target}`];
    if (known.seedDependent && !IS_SELF_HOSTED) return [];
    if (f.nodes > known.nodes) return [`${known.id} spreads: ${f.rule} on ${f.target} now hits ${f.nodes} elements, known for ${known.nodes}`];
    if (f.nodes < known.nodes) return [`${known.id} shrank: ${f.rule} on ${f.target} now hits ${f.nodes} elements, known for ${known.nodes}: partly fixed, update the baseline`];
    return [];
  });
  // A known violation that was recorded on this page and is no longer found is fixed here.
  const fixedHere = KNOWN_VIOLATIONS.filter((k) => k.pages.includes(page) && !scan.findings.some((f) => f.rule === k.rule && f.target === k.target)).map(
    (k) => `${k.id} fixed here: ${k.rule} on ${k.target} is gone from ${page}, update the baseline`,
  );
  // Soft, so a test that scans several states reports every state's violations, not just the first.
  expect.soft(problems, `new accessibility violations on ${page}`).toEqual([]);
  expect.soft(fixedHere, `accessibility violations fixed on ${page}`).toEqual([]);
}

test.describe('Accessibility scan: shop', { tag: ['@a11y', '@axe'] }, () => {
  test('home', async ({ homePage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('home', { ready: [homePage.grid.cards.first(), homePage.filters.categories, homePage.pagination.next] }), 'home');
  });

  test('search results', async ({ homePage, product, a11y }) => {
    await homePage.search.searchFor(product.name);
    await expectNoNewViolations(await a11y.scan('search results', { ready: [homePage.search.resultCount, homePage.grid.cards.first()] }), 'search results');
  });

  test('search without results', async ({ homePage, a11y }) => {
    await homePage.search.searchFor('qa-lab-no-such-product');
    await expectNoNewViolations(await a11y.scan('search without results', { ready: [homePage.search.resultCount, homePage.grid.emptyState] }), 'search without results');
  });

  test('product in stock', async ({ productPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('product', { ready: [productPage.addToCartButton, productPage.relatedProducts.first()] }), 'product');
  });

  test.describe('out of stock', () => {
    test.use({ productKind: 'out-of-stock' });

    test('product out of stock', async ({ productPage, a11y }) => {
      await expectNoNewViolations(await a11y.scan('product out of stock', { ready: [productPage.outOfStock, productPage.relatedProducts.first()] }), 'product out of stock');
    });
  });

  test('category page', async ({ categoryPage, product, a11y }) => {
    await categoryPage.open(product.category.slug);
    await expectNoNewViolations(await a11y.scan('category', { ready: [categoryPage.title, categoryPage.grid.cards.first()] }), 'category');
  });

  test('rentals', async ({ rentalsPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('rentals', { ready: [rentalsPage.title, rentalsPage.grid.cards.first()] }), 'rentals');
  });

  test.describe('comparison', () => {
    test.use({ comparedProducts: async ({ catalog }, use) => use([await catalog.inStock(), await catalog.outOfStock()]) });

    test('comparison', async ({ comparisonPage, a11y }) => {
      await expect(comparisonPage.productColumns).toHaveCount(2);
      await expectNoNewViolations(await a11y.scan('comparison', { ready: [comparisonPage.table, comparisonPage.row('Price')] }), 'comparison');
    });
  });

  test('cart with items', async ({ checkout, a11y }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    // The line's price and the total are filled in after the row itself: the last things the cart draws.
    await expectNoNewViolations(await a11y.scan('cart', { ready: [checkout.cart.table.rows, checkout.cart.table.rows.getByTestId('line-price'), checkout.cart.table.total, checkout.cart.proceedButton] }), 'cart');
  });

  test('checkout: sign in, guest, billing and payment steps', async ({ checkout, a11y }) => {
    await checkout.cart.proceed();
    await expectNoNewViolations(await a11y.scan('checkout sign-in', { ready: [checkout.signIn.signInTab, checkout.signIn.loginButton] }), 'checkout sign-in');

    await checkout.signIn.guestTab.click();
    await checkout.signIn.continueAsGuestButton.click();
    await expectNoNewViolations(await a11y.scan('checkout guest with errors', { ready: [checkout.signIn.guestEmail.error, checkout.signIn.guestFirstName.error] }), 'checkout guest with errors');

    await checkout.signIn.continueAsGuest(fakeGuest());
    const { billing, payment } = checkout;
    await expectNoNewViolations(await a11y.scan('checkout billing', { ready: [billing.heading, billing.country.input, billing.postalCode.input, billing.houseNumber.input, billing.proceedButton] }), 'checkout billing');

    await billing.enterAddress(fakeAddress());
    await billing.proceed();
    await payment.choose('credit-card');
    await expectNoNewViolations(await a11y.scan('checkout payment', { ready: [payment.heading, payment.method, payment.field('Credit Card Number'), payment.checkPaymentButton] }), 'checkout payment');
  });

  test('login with errors', async ({ loginPage, a11y }) => {
    await loginPage.loginButton.click();
    await expectNoNewViolations(await a11y.scan('login with errors', { ready: [loginPage.email.error, loginPage.password.error] }), 'login with errors');
  });

  test('registration with errors', async ({ registerPage, a11y }) => {
    await registerPage.submit();
    await expectNoNewViolations(await a11y.scan('register with errors', { ready: [registerPage.firstName.error, registerPage.password.error] }), 'register with errors');
  });

  test('forgot password', async ({ forgotPasswordPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('forgot password', { ready: [forgotPasswordPage.heading, forgotPasswordPage.submitButton] }), 'forgot password');
  });

  test('contact with errors', async ({ contactPage, a11y }) => {
    await contactPage.submit();
    await expectNoNewViolations(await a11y.scan('contact with errors', { ready: [contactPage.firstName.error, contactPage.message.error] }), 'contact with errors');
  });

  test('chat open', async ({ homePage, a11y }) => {
    await homePage.shell.chat.open();
    await expectNoNewViolations(await a11y.scan('chat open', { ready: [homePage.shell.chat.window, homePage.shell.chat.greeting] }), 'chat open');
  });

  test('privacy policy', async ({ homePage, a11y, page }) => {
    await homePage.shell.footer.openPrivacyPolicy();
    await expect(page).toHaveURL('/privacy');
    await expectNoNewViolations(await a11y.scan('privacy policy', { ready: [page.getByRole('heading', { level: 1 })] }), 'privacy policy');
  });

  test('unknown route', async ({ page, homePage, a11y }) => {
    // There is no 404 page: an unknown route redirects to / but the page stays empty (BUG-02), so what renders is
    // the shell alone. It is ready once the redirect has happened and the shell's last part, the footer, has drawn.
    await page.goto('/this/route/does/not/exist', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/');
    const { header, footer } = homePage.shell;
    await expectNoNewViolations(await a11y.scan('unknown route', { ready: [header.homeLink, header.signInLink, footer.privacyPolicyLink, footer.githubLink] }), 'unknown route');
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
    // The signed-in header and the four tiles come with the user's data: the tiles are what the page draws last.
    const tiles = (['Favorites', 'Profile', 'Invoices', 'Messages'] as const).map((section) => accountPage.sectionLink(section));
    await expectNoNewViolations(await a11y.scan('account', { ready: [accountPage.title, accountPage.header.userMenu, ...tiles] }), 'account');
  });

  test('favorites', async ({ favoritesPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('account favorites', { ready: [favoritesPage.title, favoritesPage.emptyState] }), 'account favorites');
  });

  test('invoices', async ({ invoicesPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('account invoices', { ready: [invoicesPage.title, invoicesPage.table] }), 'account invoices');
  });

  test('messages', async ({ messagesPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('account messages', { ready: [messagesPage.title, messagesPage.emptyState] }), 'account messages');
  });

  test('profile', async ({ profilePage, a11y }) => {
    // The form is filled from GET /users/me: a populated field is the last thing the page draws.
    await expect(profilePage.firstName.input).not.toHaveValue('');
    await expectNoNewViolations(await a11y.scan('account profile', { ready: [profilePage.title, profilePage.firstName.input, profilePage.newPassword, profilePage.changePasswordButton] }), 'account profile');
  });
});

test.describe('Accessibility scan: back office (mocked admin)', { tag: ['@a11y', '@axe', '@mocked'] }, () => {
  test('dashboard', async ({ adminDashboard, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin dashboard', { ready: [adminDashboard.salesHeading, adminDashboard.salesChart, adminDashboard.latestOrders.rows.first()] }), 'admin dashboard');
  });

  test('products list and product form', async ({ adminProducts, backOffice, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin products', { ready: [adminProducts.table.rows.first()] }), 'admin products');

    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    await expectNoNewViolations(await a11y.scan('admin product form', { ready: [form.name] }), 'admin product form');
  });

  test('brands and the brand form with errors', async ({ adminBrands, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin brands', { ready: [adminBrands.table.rows.first()] }), 'admin brands');

    const form = await adminBrands.add();
    await form.chrome.save();
    await expectNoNewViolations(await a11y.scan('admin brand form', { ready: [form.name.error] }), 'admin brand form');
  });

  test('categories', async ({ adminCategories, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin categories', { ready: [adminCategories.table.rows.first()] }), 'admin categories');
  });

  test('orders and an order', async ({ adminOrders, backOffice, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin orders', { ready: [adminOrders.table.rows.first()] }), 'admin orders');

    const order = await adminOrders.edit(backOffice.order.invoice_number);
    await expectNoNewViolations(await a11y.scan('admin order', { ready: [order.invoiceNumber, order.lines.first()] }), 'admin order');
  });

  test('users and the user form', async ({ adminUsers, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin users', { ready: [adminUsers.table.rows.first()] }), 'admin users');

    const form = await adminUsers.edit(customer.email);
    await expect(form.email).toHaveValue(customer.email);
    await expectNoNewViolations(await a11y.scan('admin user form', { ready: [form.email] }), 'admin user form');
  });

  test('messages and a message', async ({ adminMessages, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin messages', { ready: [adminMessages.table.rows.first()] }), 'admin messages');

    const message = await adminMessages.details(`${customer.first_name} ${customer.last_name}`);
    await expectNoNewViolations(await a11y.scan('admin message', { ready: [message.replyBox, message.status] }), 'admin message');
  });

  test('statistics', async ({ adminStatistics, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin statistics', { ready: [adminStatistics.heading, adminStatistics.report('Customers By Country').first()] }), 'admin statistics');
  });

  test('average sales report', async ({ adminMonthlySales, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin sales report', { ready: [adminMonthlySales.heading, adminMonthlySales.year, adminMonthlySales.chart] }), 'admin sales report');
  });

  test('settings', async ({ adminSettings, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin settings', { ready: [adminSettings.paymentEndpoint, adminSettings.saveButton] }), 'admin settings');
  });
});

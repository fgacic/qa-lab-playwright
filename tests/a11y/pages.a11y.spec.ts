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

import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { PAYMENT_FIELDS } from '@components/checkout/PaymentStep';
import { CART_MESSAGES } from '@components/CartTable';
import { expect, mock, test, withMocks } from '@fixtures';
import { EXCLUDED, NO_SUCH_PRODUCT, type A11yScan } from '@fixtures/a11y';
import { emptyCartMock, postcodeLookupMock } from '@fixtures/mocks';
import { ADMIN_MESSAGES } from '@pages/admin/alerts';
import { brand, customer } from '@support/admin-payloads';
import { holdTimer } from '@support/clock';
import { UNKNOWN_ROUTE_LOG } from '@support/console-guard';
import { diffFindings, KNOWN_VIOLATIONS, type ScanName } from '@support/a11y-baseline';
import { IS_SELF_HOSTED } from '@support/env';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { horizontalOverflow } from '@support/page-metrics';
import { acceptedGuestInvoice, fakeUser, listOf } from '@support/payloads';
import { fakeAddress, fakeGuest } from '@support/test-data';

/** How long the shop's alerts stay before they fade (its own 3 s timer): what `holdTimer` keeps from firing during a scan. */
const ALERT_FADE_MS = 3_000;

/**
 * Fails the test on what a scan found that the baseline does not know, and on a known violation that changed
 * (spread, shrank, escalated or is gone from a page it was recorded on). `A11Y_RECORD` rebuilds the baseline instead.
 */
async function expectNoNewViolations(scan: A11yScan, page: ScanName): Promise<void> {
  // A11Y_RECORD=<file> appends every finding as JSON lines: how the baseline is (re)built.
  if (process.env.A11Y_RECORD) {
    // A recording is a deliberate local act: on CI it would turn every violation into "known".
    if (process.env.CI) throw new Error('A11Y_RECORD is for rebuilding the baseline locally; it refuses to run when CI is set.');
    // A recording asserts nothing about the shop, so it must never read as a pass: the test is failed (soft, so every state still records)
    // and annotated, and the file is the output. Rebuilding the baseline is not a test run.
    const note = `recording ${scan.findings.length} finding(s) on "${page}" to ${process.env.A11Y_RECORD}: NOTHING WAS ASSERTED, this is not a test run`;
    test.info().annotations.push({ type: 'A11Y_RECORD', description: note });
    expect.soft(false, `A11Y_RECORD is set: ${note}`).toBe(true);
    for (const finding of scan.findings) fs.appendFileSync(process.env.A11Y_RECORD, JSON.stringify({ page, ...finding }) + '\n');
    return;
  }
  // The decision (new, spread, shrank, impact, fixed) is `diffFindings`, table-tested in tests/framework/a11y-ratchet.spec.ts.
  const { problems, fixed: fixedHere } = diffFindings(KNOWN_VIOLATIONS, scan.findings, page, { selfHosted: IS_SELF_HOSTED });
  // Soft, so a test that scans several states reports every state's violations, not just the first.
  expect.soft(problems, `new accessibility violations on ${page}`).toEqual([]);
  expect.soft(fixedHere, `accessibility violations fixed on ${page}`).toEqual([]);
}

// Once per worker, not once per scan and not from state kept in the module: a recording is not a run to be read as a pass.
test.beforeAll(() => {
  if (process.env.A11Y_RECORD) console.warn(`\n!! A11Y_RECORD is set: the accessibility scans RECORD to ${process.env.A11Y_RECORD} and assert nothing. Do not read this run as a pass.\n`);
});

// Before any navigation, on the context, so the page's own scripts and transitions see it from the first paint (the scan fixture checks it).
test.use({ reducedMotion: 'reduce' });

test.describe('Accessibility scan: shop', { tag: ['@a11y', '@axe'] }, () => {
  test('no new violations on the home page', async ({ homePage, a11y }) => {
    // A subcategory's checkbox sits in a group nested in the filters: the last part of the sidebar to be drawn, and what AX-11 is about.
    const subcategory = homePage.filters.categories.getByRole('group', { name: 'Categories' }).getByRole('checkbox').first();
    await expectNoNewViolations(await a11y.scan('home', { ready: [homePage.grid.cards.first(), homePage.filters.categories, subcategory, homePage.pagination.next] }), 'home');
  });

  // The training aids are left out of every scan (EXCLUDED); an exclusion for something the shop no longer renders is a hole left open for nothing.
  test('every excluded training aid that is drawn at first is still on the page', async ({ homePage }) => {
    for (const { selector, reason } of EXCLUDED.filter((excluded) => !excluded.shownBy)) {
      await expect(homePage.page.locator(selector).first(), `${selector} (${reason}) is still rendered`).toBeAttached();
    }
  });

  test('every excluded training aid that a control opens is still drawn by it', async ({ homePage }) => {
    // Each aid is opened on a fresh page: the panel one control opens could cover the next control.
    for (const { selector, reason, shownBy } of EXCLUDED.flatMap((excluded) => (excluded.shownBy ? [{ ...excluded, shownBy: excluded.shownBy }] : []))) {
      await homePage.page.reload();
      await homePage.page.locator(shownBy).click();
      await expect(homePage.page.locator(selector).first(), `${selector} (${reason}) is drawn once ${shownBy} is clicked`).toBeAttached();
    }
  });

  test('no new violations on search results', async ({ homePage, product, a11y }) => {
    await homePage.search.searchFor(product.name);
    await expectNoNewViolations(await a11y.scan('search results', { ready: [homePage.search.resultCount, homePage.grid.cards.first()] }), 'search results');
  });

  test('no new violations on a search without results', async ({ homePage, a11y }) => {
    await homePage.search.searchFor(NO_SUCH_PRODUCT);
    await expectNoNewViolations(await a11y.scan('search without results', { ready: [homePage.search.resultCount, homePage.grid.emptyState] }), 'search without results');
  });

  test('no new violations on a product in stock', async ({ productPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('product', { ready: [productPage.addToCartButton, productPage.relatedProducts.first()] }), 'product');
  });

  test.describe('out of stock', () => {
    test.use({ productKind: 'out-of-stock' });

    test('no new violations on a product out of stock', async ({ productPage, a11y }) => {
      await expectNoNewViolations(await a11y.scan('product out of stock', { ready: [productPage.outOfStock, productPage.relatedProducts.first()] }), 'product out of stock');
    });
  });

  test('no new violations on a category page', async ({ categoryPage, product, a11y }) => {
    await categoryPage.open(product.category.slug);
    await expectNoNewViolations(await a11y.scan('category', { ready: [categoryPage.title, categoryPage.grid.cards.first()] }), 'category');
  });

  test('no new violations on the rentals page', async ({ rentalsPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('rentals', { ready: [rentalsPage.title, rentalsPage.grid.cards.first()] }), 'rentals');
  });

  test.describe('comparison', () => {
    test.use({ comparedProducts: async ({ catalog }, use) => use([await catalog.inStock(), await catalog.outOfStock()]) });

    test('no new violations on the comparison', async ({ comparisonPage, a11y }) => {
      await expect(comparisonPage.productColumns).toHaveCount(2);
      await expectNoNewViolations(await a11y.scan('comparison', { ready: [comparisonPage.table, comparisonPage.row('Price')] }), 'comparison');
    });
  });

  test('no new violations on the empty comparison', async ({ comparisonPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('empty comparison', { ready: [comparisonPage.title, comparisonPage.emptyState] }), 'empty comparison');
  });

  test.describe('empty cart (mocked)', { tag: ['@mocked'] }, () => {
    // The shop answers the cart with no lines: the state it words ("The cart is empty."), unlike a visitor with no cart at all (BUG-13).
    test.use(withMocks(emptyCartMock));

    test('no new violations on an empty cart', async ({ checkout, a11y }) => {
      await expectNoNewViolations(await a11y.scan('empty cart', { ready: [checkout.cart.emptyMessage] }), 'empty cart');
    });
  });

  test('no new violations on a cart with items', async ({ checkout, a11y }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    // The line's price and the total are filled in after the row itself: the last things the cart draws.
    await expectNoNewViolations(await a11y.scan('cart', { ready: [checkout.cart.table.rows, checkout.cart.table.rows.getByTestId('line-price'), checkout.cart.table.total, checkout.cart.proceedButton] }), 'cart');
  });

  test('no new violations on the checkout steps: sign in, guest, billing and payment', async ({ checkout, a11y }) => {
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
    await expectNoNewViolations(await a11y.scan('checkout payment', { ready: [payment.heading, payment.method, payment.field(PAYMENT_FIELDS.cardNumber), payment.checkPaymentButton] }), 'checkout payment');
  });

  test.describe('order confirmation (mocked order)', { tag: ['@mocked'] }, () => {
    // The check and the order are writes: answered by mocks, so no order is ever placed (the write guard refuses any other).
    test.use(withMocks(postcodeLookupMock, mock.respond('POST', '/payment/check', { message: 'Payment was successful' }), mock.respond('POST', '/invoices/guest', acceptedGuestInvoice, 201)));

    test('no new violations on the order confirmation', async ({ checkout, a11y }) => {
      await checkout.checkOutAsGuest(fakeGuest(), fakeAddress());
      await expectNoNewViolations(await a11y.scan('order confirmation', { ready: [checkout.wizard.confirmation] }), 'order confirmation');
    });
  });

  test('no new violations on the login form with errors', async ({ loginPage, a11y }) => {
    await loginPage.loginButton.click();
    await expectNoNewViolations(await a11y.scan('login with errors', { ready: [loginPage.email.error, loginPage.password.error] }), 'login with errors');
  });

  test('no new violations on the registration form with errors', async ({ registerPage, a11y }) => {
    await registerPage.submit();
    await expectNoNewViolations(await a11y.scan('register with errors', { ready: [registerPage.firstName.error, registerPage.password.error] }), 'register with errors');
  });

  test('no new violations on the forgot-password page', async ({ forgotPasswordPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('forgot password', { ready: [forgotPasswordPage.heading, forgotPasswordPage.submitButton] }), 'forgot password');
  });

  test.describe('forgot-password request accepted (mocked)', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/users/forgot-password', { success: true })));

    test('no new violations on the forgot-password confirmation', async ({ page, forgotPasswordPage, a11y }) => {
      // The alert fades out after three seconds, which a slow scan can outlast: that one timer never fires (a paused clock would stall axe's own).
      await holdTimer(page, ALERT_FADE_MS);
      await forgotPasswordPage.open();
      await forgotPasswordPage.requestReset(fakeUser.email);
      await expectNoNewViolations(await a11y.scan('forgot password sent', { ready: [forgotPasswordPage.alert] }), 'forgot password sent');
    });
  });

  test('no new violations on the contact form with errors', async ({ contactPage, a11y }) => {
    await contactPage.submit();
    await expectNoNewViolations(await a11y.scan('contact with errors', { ready: [contactPage.firstName.error, contactPage.message.error] }), 'contact with errors');
  });

  test('no new violations on the open language menu', async ({ homePage, a11y }) => {
    await homePage.header.language.button.click();
    await expectNoNewViolations(await a11y.scan('language menu open', { ready: [homePage.header.language.menu, homePage.header.language.option('en')] }), 'language menu open');
  });

  test('no new violations on the add-to-cart toast', async ({ productPage, a11y }) => {
    await productPage.addToCart();
    await expectNoNewViolations(await a11y.scan('product with a toast', { ready: [productPage.toast.message(CART_MESSAGES.added), productPage.addToCartButton] }), 'product with a toast');
  });

  test('no new violations on the compare bar', async ({ homePage, a11y }) => {
    await homePage.grid.nth(0).compareButton.click();
    await expect(homePage.compareBar.selection).toHaveText('1 product(s) selected');
    await expectNoNewViolations(await a11y.scan('compare bar', { ready: [homePage.compareBar.root, homePage.compareBar.selection, homePage.compareBar.clearAllButton] }), 'compare bar');
  });

  test('no new violations on the open chat', async ({ homePage, a11y }) => {
    await homePage.shell.chat.open();
    await expectNoNewViolations(await a11y.scan('chat open', { ready: [homePage.shell.chat.window, homePage.shell.chat.greeting] }), 'chat open');
  });

  test('no new violations on the privacy policy', async ({ homePage, a11y, page }) => {
    await homePage.shell.footer.openPrivacyPolicy();
    await expect(page).toHaveURL('/privacy');
    await expectNoNewViolations(await a11y.scan('privacy policy', { ready: [page.getByRole('heading', { level: 1 })] }), 'privacy policy');
  });

  test('no new violations on an unknown route', async ({ page, homePage, a11y, consoleGuard }) => {
    consoleGuard.allow(UNKNOWN_ROUTE_LOG.pattern, UNKNOWN_ROUTE_LOG.reason);
    // There is no 404 page: an unknown route redirects to / but the page stays empty (BUG-02), so what renders is
    // the shell alone. It is ready once the redirect has happened and the shell's last part, the footer, has drawn.
    await page.goto('/this/route/does/not/exist', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/');
    const { header, footer } = homePage.shell;
    await expectNoNewViolations(await a11y.scan('unknown route', { ready: [header.homeLink, header.signInLink, footer.privacyPolicyLink, footer.githubLink] }), 'unknown route');
  });
});

/** WCAG 1.4.10 reflow: a 320 CSS px wide page needs no sideways scrolling. */
const REFLOW_WIDTH = 320;

// The viewport the reflow (1.4.10) and target-size (2.5.8) criteria are about. The header collapses behind its toggler here, so the page is not the desktop one scaled down.
test.describe('Accessibility scan: phone width', { tag: ['@a11y', '@axe'] }, () => {
  test.use({ viewport: { width: REFLOW_WIDTH, height: 640 } });

  // Polled, not read once: a late image or a font swap can widen the page a moment after the scan's own wait.
  const expectReflows = async (page: Page) => {
    await expect
      .soft.poll(() => horizontalOverflow(page), { message: `the page is wider than a ${REFLOW_WIDTH}px screen (WCAG 1.4.10 reflow)` })
      .toBeLessThanOrEqual(0);
  };

  test('no new violations on the home page on a phone', async ({ homePage, a11y, page }) => {
    await expectNoNewViolations(await a11y.scan('home on a phone', { ready: [homePage.grid.cards.first(), homePage.pagination.next] }), 'home on a phone');
    await expectReflows(page);
  });

  test('no new violations on the open mobile menu', async ({ homePage, a11y }) => {
    await homePage.header.menuToggle.click();
    await expectNoNewViolations(await a11y.scan('mobile menu open', { ready: [homePage.header.homeLink, homePage.header.contactLink, homePage.header.signInLink] }), 'mobile menu open');
  });

  test('no new violations on a cart on a phone', async ({ checkout, a11y }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    // Its width is AX-15's, pinned below: this scan is for the axe rules.
    await expectNoNewViolations(await a11y.scan('cart on a phone', { ready: [checkout.cart.table.rows, checkout.cart.table.rows.getByTestId('line-price'), checkout.cart.table.total, checkout.cart.proceedButton] }), 'cart on a phone');
  });

  test('AX-15 the cart fits a 320px screen without sideways scrolling', { tag: ['@bug'] }, async ({ checkout, page }) => {
    knownBug('AX-15', 'the cart table keeps its desktop width (about 370px) on a 320px screen, so the page scrolls sideways (WCAG 1.4.10 reflow)');
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expect(checkout.cart.table.total).toBeVisible();

    await expect.poll(() => horizontalOverflow(page), { message: `AX-15: the cart is no wider than a ${REFLOW_WIDTH}px screen`, timeout: BUG_TIMEOUT }).toBeLessThanOrEqual(0);
  });

  test('no new violations on the login form on a phone', async ({ loginPage, a11y, page }) => {
    await expectNoNewViolations(await a11y.scan('login on a phone', { ready: [loginPage.email.input, loginPage.password.input, loginPage.loginButton] }), 'login on a phone');
    await expectReflows(page);
  });

  test('no new violations on the checkout billing step on a phone', async ({ checkout, a11y, page }) => {
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
    const { billing } = checkout;
    await expectNoNewViolations(await a11y.scan('checkout billing on a phone', { ready: [billing.heading, billing.country.input, billing.postalCode.input, billing.houseNumber.input, billing.proceedButton] }), 'checkout billing on a phone');
    await expectReflows(page);
  });

  test('no new violations on a product on a phone', async ({ productPage, a11y, page }) => {
    await expectNoNewViolations(await a11y.scan('product on a phone', { ready: [productPage.addToCartButton, productPage.relatedProducts.first()] }), 'product on a phone');
    await expectReflows(page);
  });
});

test.describe('Accessibility scan: account (mocked session)', { tag: ['@a11y', '@axe', '@mocked'] }, () => {
  test.use(withMocks(
    mock.respond('GET', '/favorites', []),
    mock.respond('GET', '/invoices', listOf([])),
    mock.respond('GET', '/messages', listOf([])),
    mock.respond('POST', '/totp/setup', {}),
  ));

  test('no new violations on the account page', async ({ accountPage, a11y }) => {
    // The signed-in header and the four tiles come with the user's data: the tiles are what the page draws last.
    const tiles = (['Favorites', 'Profile', 'Invoices', 'Messages'] as const).map((section) => accountPage.sectionLink(section));
    await expectNoNewViolations(await a11y.scan('account', { ready: [accountPage.title, accountPage.header.userMenu, ...tiles] }), 'account');
  });

  test('no new violations on favorites', async ({ favoritesPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('account favorites', { ready: [favoritesPage.title, favoritesPage.emptyState] }), 'account favorites');
  });

  test('no new violations on invoices', async ({ invoicesPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('account invoices', { ready: [invoicesPage.title, invoicesPage.table] }), 'account invoices');
  });

  test('no new violations on messages', async ({ messagesPage, a11y }) => {
    await expectNoNewViolations(await a11y.scan('account messages', { ready: [messagesPage.title, messagesPage.emptyState] }), 'account messages');
  });

  test('no new violations on the profile with errors', async ({ profilePage, a11y }) => {
    await expect(profilePage.firstName.input).not.toHaveValue('');
    await profilePage.firstName.input.fill('');
    await profilePage.update();
    const notice = profilePage.alert('Please correct the highlighted fields before saving.');
    await expectNoNewViolations(await a11y.scan('account profile with errors', { ready: [notice, profilePage.firstName.input] }), 'account profile with errors');
  });

  test('no new violations on the profile', async ({ profilePage, a11y }) => {
    // The form is filled from GET /users/me: a populated field is the last thing the page draws.
    await expect(profilePage.firstName.input).not.toHaveValue('');
    await expectNoNewViolations(await a11y.scan('account profile', { ready: [profilePage.title, profilePage.firstName.input, profilePage.newPassword, profilePage.changePasswordButton] }), 'account profile');
  });
});

test.describe('Accessibility scan: back office (mocked admin)', { tag: ['@a11y', '@axe', '@mocked'] }, () => {
  test('no new violations on the dashboard', async ({ adminDashboard, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin dashboard', { ready: [adminDashboard.salesHeading, adminDashboard.salesChart, adminDashboard.latestOrders.rows.first()] }), 'admin dashboard');
  });

  test('no new violations on the products list and the product form', async ({ adminProducts, backOffice, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin products', { ready: [adminProducts.table.rows.first()] }), 'admin products');

    const form = await adminProducts.edit(backOffice.product.id);
    await expect(form.name).toHaveValue(backOffice.product.name);
    await expectNoNewViolations(await a11y.scan('admin product form', { ready: [form.name] }), 'admin product form');
  });

  test('no new violations on the brands list and the brand form with errors', async ({ adminBrands, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin brands', { ready: [adminBrands.table.rows.first()] }), 'admin brands');

    const form = await adminBrands.add();
    await form.chrome.save();
    await expectNoNewViolations(await a11y.scan('admin brand form', { ready: [form.name.error] }), 'admin brand form');
  });

  test('no new violations on a deleted brand (the delete confirmation)', async ({ adminBrands, apiMock, a11y }) => {
    // The site asks nothing before deleting (ADM-02), so the state to scan is what it shows once the brand is gone: its confirmation alert, over the emptied list.
    await apiMock.use(mock.respond('GET', '/brands', []));
    await adminBrands.table.delete(brand.name);
    await expectNoNewViolations(await a11y.scan('admin brand deleted', { ready: [adminBrands.alert(ADMIN_MESSAGES.brandDeleted)] }), 'admin brand deleted');
  });

  test('no new violations on categories', async ({ adminCategories, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin categories', { ready: [adminCategories.table.rows.first()] }), 'admin categories');
  });

  test('no new violations on the orders list and an order', async ({ adminOrders, backOffice, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin orders', { ready: [adminOrders.table.rows.first()] }), 'admin orders');

    const order = await adminOrders.edit(backOffice.order.invoice_number);
    await expectNoNewViolations(await a11y.scan('admin order', { ready: [order.invoiceNumber, order.lines.first()] }), 'admin order');
  });

  test('no new violations on the users list and the user form', async ({ adminUsers, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin users', { ready: [adminUsers.table.rows.first()] }), 'admin users');

    const form = await adminUsers.edit(customer.email);
    await expect(form.email).toHaveValue(customer.email);
    await expectNoNewViolations(await a11y.scan('admin user form', { ready: [form.email] }), 'admin user form');
  });

  test('no new violations on the messages list and a message', async ({ adminMessages, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin messages', { ready: [adminMessages.table.rows.first()] }), 'admin messages');

    const message = await adminMessages.details(`${customer.first_name} ${customer.last_name}`);
    await expectNoNewViolations(await a11y.scan('admin message', { ready: [message.replyBox, message.status] }), 'admin message');
  });

  test('no new violations on statistics', async ({ adminStatistics, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin statistics', { ready: [adminStatistics.heading, adminStatistics.report('Customers By Country').first()] }), 'admin statistics');
  });

  test('no new violations on the average sales report', async ({ adminMonthlySales, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin sales report', { ready: [adminMonthlySales.heading, adminMonthlySales.year, adminMonthlySales.chart] }), 'admin sales report');
  });

  test('no new violations on settings', async ({ adminSettings, a11y }) => {
    await expectNoNewViolations(await a11y.scan('admin settings', { ready: [adminSettings.paymentEndpoint, adminSettings.saveButton] }), 'admin settings');
  });
});

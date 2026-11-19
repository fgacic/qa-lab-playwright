import fs from 'node:fs';
import path from 'node:path';
import { PAYMENT_FIELDS } from '@components/checkout/PaymentStep';
import { expect, mock, test, withMocks } from '@fixtures';
import type { Page } from '@playwright/test';
import type { HomePage } from '@pages/HomePage';
import { emptyCartMock } from '@fixtures/mocks';
import { SUITE_OWNED_NAME } from '@support/catalog-terms';
import { settleImages } from '@support/visual';
import { emptyProductPage } from '@support/payloads';
import { fakeAddress, fakeGuest } from '@support/test-data';
import type { ToolshopApi } from '@support/toolshop-api';

/**
 * Screenshot comparisons of key pages and states. Baselines are recorded and compared only
 * inside the official Playwright image (scripts/visual.sh, pinned by digest and run as linux/amd64),
 * against the freshly seeded self-hosted shop: same fonts, same data, same pixels everywhere. Animations
 * are off, a shot waits for every image to be decoded, and anything that can change between runs is masked.
 *
 * What this covers, and what it does not: ONE engine (Chromium, no Firefox or WebKit rendering), ONE theme (the shop has a
 * single, light one: colour scheme is pinned to light), ONE language for every page but one (English; the home page is also taken in German, whose words run longest),
 * ONE desktop width (1280×800) and ONE phone width (390×844, the home page and the cart). A layout break that only shows in another
 * engine, another width or another language is not seen here; the functional specs and the axe reflow check (tests/a11y) carry what they can of that.
 *
 * Two kinds of budget, because they prove different things. The full-page shots use the default `maxDiffPixels`
 * of playwright.config.ts (150): a net for layout, colour and missing or moved blocks. It does NOT catch a
 * changed price or label, which is a few dozen pixels. Those regions (a product's price, a card's price, the out-of-stock
 * label, the cart's total) have element shots of their own with no budget at all: `maxDiffPixels: 0` and `threshold: 0`
 * (the default per-pixel colour tolerance would let a slightly different shade of the same glyph through), so one changed glyph fails them.
 */
/** No pixel may differ, by any amount: for the regions a customer reads to decide (see the header). */
const ZERO_BUDGET = { maxDiffPixels: 0, threshold: 0 } as const;
/**
 * For a shot of one small element, not a page: the default 150 differing pixels would be a large share of it (a changed word is about
 * that many), so the budget is tighter, 30 pixels, which still absorbs the anti-aliasing of rounded corners.
 */
const SMALL_ELEMENT_BUDGET = { maxDiffPixels: 30 } as const;

/** The home page's first page of cards, all of them: as many as the API serves for it, so a shot is not taken mid-render. */
const gridFullyDrawn = async (homePage: HomePage, api: ToolshopApi): Promise<void> => {
  const firstPage = await api.listProducts();
  await expect(homePage.grid.cards).toHaveCount(firstPage.data.length);
};

/** The price-range sliders, whose handles sit where the data put them: masked in every shot that has them. */
const sliders = (page: Page) => [page.getByRole('slider')];

test.describe('Visual regression', { tag: ['@visual'] }, () => {
  test('home page', async ({ homePage, api, page }) => {
    await gridFullyDrawn(homePage, api);
    await settleImages(page);
    await expect(page).toHaveScreenshot('home.png', { fullPage: true, mask: sliders(page) });
  });

  test('product page', async ({ productPage, page }) => {
    await expect(productPage.relatedProducts.first()).toBeVisible();
    // Related products are picked by the API and their order varies.
    await settleImages(page);
    await expect(page).toHaveScreenshot('product.png', { fullPage: true, mask: [productPage.relatedProducts] });
  });

  test('category page', async ({ categoryPage, api, page }) => {
    // The shop's first top-level category, from its own tree: the same one on every freshly seeded shop.
    const [first] = await api.categoryTree();
    await categoryPage.open(first.slug);
    await expect(categoryPage.grid.cards.first()).toBeVisible();
    await settleImages(page);
    await expect(page).toHaveScreenshot('category.png', { fullPage: true });
  });

  // The rentals list is the one page that shows the suite's own temporary rentals ("QaLab ...", made for the moments the back-office and
  // stored-XSS specs run), so the shot depends on what else is running. The page is answered with the seeded rentals only: the same list
  // the shop gives when nothing else is running, so the baseline is the real page, and no other spec can change it.
  test.describe('rentals', () => {
    test.use({
      apiMocks: async ({ api }, use) => {
        const rentals = await api.listProducts({ is_rental: 'true' });
        const seeded = rentals.data.filter((product) => !SUITE_OWNED_NAME.test(product.name));
        await use({ routes: [mock.respond('QUERY', '/products', { ...rentals, data: seeded, total: seeded.length })] });
      },
    });

    test('rentals', async ({ rentalsPage, page }) => {
      await expect(rentalsPage.grid.cards.first()).toBeVisible();
      await settleImages(page);
      await expect(page).toHaveScreenshot('rentals.png', { fullPage: true });
    });
  });

  test('contact form with errors', async ({ contactPage, page }) => {
    await contactPage.submit();
    await expect(contactPage.message.error).toBeVisible();
    await settleImages(page);
    await expect(page).toHaveScreenshot('contact-errors.png', { fullPage: true });
  });

  test('login with errors', async ({ loginPage, page }) => {
    await loginPage.loginButton.click();
    await expect(loginPage.password.error).toBeVisible();
    await settleImages(page);
    await expect(page).toHaveScreenshot('login-errors.png');
  });

  test('registration with errors', async ({ registerPage, page }) => {
    await registerPage.submit();
    await expect(registerPage.password.error).toBeVisible();
    await settleImages(page);
    await expect(page).toHaveScreenshot('register-errors.png', { fullPage: true });
  });

  test('cart with a product', async ({ checkout, page }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await settleImages(page);
    await expect(page).toHaveScreenshot('cart.png');
  });

  test('checkout guest form with errors', async ({ checkout, page }) => {
    await checkout.cart.proceed();
    await checkout.signIn.guestTab.click();
    await checkout.signIn.continueAsGuestButton.click();
    await expect(checkout.signIn.guestEmail.error).toBeVisible();
    await settleImages(page);
    await expect(page).toHaveScreenshot('checkout-guest-errors.png');
  });

  test.describe('empty cart (mocked)', { tag: ['@mocked'] }, () => {
    // The shop answers the cart with no lines: the state it words ("The cart is empty."), unlike a visitor with no cart at all (BUG-13).
    test.use(withMocks(emptyCartMock));

    test('empty cart', async ({ checkout, page }) => {
      await expect(checkout.cart.emptyMessage).toBeVisible();
      await settleImages(page);
      await expect(page).toHaveScreenshot('cart-empty.png');
    });
  });

  test('checkout billing step', async ({ checkout, page }) => {
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
    await expect(checkout.billing.heading).toBeVisible();
    // The guest summary line carries the generated email.
    await settleImages(page);
    await expect(page).toHaveScreenshot('checkout-billing.png', { mask: [checkout.signIn.guestSummary] });
  });

  test.describe('out of stock', () => {
    test.use({ productKind: 'out-of-stock' });

    test('product out of stock', async ({ productPage, page }) => {
      await expect(productPage.outOfStock).toBeVisible();
      await settleImages(page);
      await expect(page).toHaveScreenshot('product-out-of-stock.png', { fullPage: true, mask: [productPage.relatedProducts] });
    });
  });

  test('checkout payment step', async ({ checkout, page }) => {
    await checkout.proceedToPayment(fakeGuest(), fakeAddress());
    await checkout.payment.choose('credit-card');
    await expect(checkout.payment.field(PAYMENT_FIELDS.cardNumber)).toBeVisible();
    // The guest summary line carries the generated email.
    await settleImages(page);
    await expect(page).toHaveScreenshot('checkout-payment.png', { fullPage: true, mask: [checkout.signIn.guestSummary] });
  });

  // Element shots with no budget: the text a customer reads to decide, which the 150-pixel full-page budget would let change.
  test('product price', async ({ productPage }) => {
    await expect(productPage.price).toBeVisible();
    await expect(productPage.price).toHaveScreenshot('product-price.png', ZERO_BUDGET);
  });

  test('price on the first product card', async ({ homePage, api }) => {
    // The first card of the shop's default order, which is the same on every freshly seeded shop: its price is read from the grid, not from the product page.
    await gridFullyDrawn(homePage, api);
    await expect(homePage.grid.first().price).toBeVisible();
    await expect(homePage.grid.first().price).toHaveScreenshot('card-price.png', ZERO_BUDGET);
  });

  test.describe('out of stock label', () => {
    test.use({ productKind: 'out-of-stock' });

    test('out-of-stock label', async ({ productPage }) => {
      await expect(productPage.outOfStock).toBeVisible();
      await expect(productPage.outOfStock).toHaveScreenshot('out-of-stock-label.png', ZERO_BUDGET);
    });
  });

  test('cart total', async ({ checkout }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expect(checkout.cart.table.total).toBeVisible();
    await expect(checkout.cart.table.total).toHaveScreenshot('cart-total.png', ZERO_BUDGET);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('home page on a phone', async ({ homePage, page }) => {
      await expect(homePage.grid.cards.first()).toBeVisible();
      await settleImages(page);
      // The header collapses behind its toggler here: the shot proves the phone layout, so it is the screen, not the page.
      await expect(page).toHaveScreenshot('home-phone.png');
    });
  });

  test.describe('cart on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    // The layout AX-15 (tests/a11y) reports as too wide at 320 px: this is the screen it still fits, so the day it is fixed there is a baseline to hold.
    test('cart on a phone', async ({ checkout, page }) => {
      await expect(checkout.cart.table.rows).toHaveCount(1);
      await settleImages(page);
      await expect(page).toHaveScreenshot('cart-phone.png');
    });
  });

  test.describe('catalogue with no products (mocked)', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products', emptyProductPage())));

    test('home page with an empty catalogue', async ({ homePage, page }) => {
      await expect(homePage.grid.emptyState).toBeVisible();
      await settleImages(page);
      await expect(page).toHaveScreenshot('home-empty-catalogue.png', { fullPage: true, mask: sliders(page) });
    });
  });

  test('home page in German', async ({ homePage, api, page }) => {
    // The longest words of the shop's seven languages: where a header or a button that is sized for English would overflow or wrap.
    await homePage.header.language.switchTo('de');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(homePage.header.navItem('categories')).toHaveText('Kategorien');
    await gridFullyDrawn(homePage, api);
    await settleImages(page);
    await expect(page).toHaveScreenshot('home-de.png', { fullPage: true, mask: sliders(page) });
  });

  test('language menu open', async ({ homePage }) => {
    const { language } = homePage.header;
    await language.button.click();
    await expect(language.menu).toBeVisible();
    await expect(language.option('de')).toBeVisible();
    await expect(language.menu).toHaveScreenshot('language-menu.png', SMALL_ELEMENT_BUDGET);
  });

  test('a button hovered', async ({ productPage }) => {
    await productPage.addToCartButton.hover();
    // The hover colour is the state under test: the pointer rests on the button and nothing moves.
    await expect(productPage.addToCartButton).toHaveScreenshot('add-to-cart-hovered.png', SMALL_ELEMENT_BUDGET);
  });

  test('a field focused', async ({ loginPage }) => {
    await loginPage.email.input.focus();
    await expect(loginPage.email.input).toBeFocused();
    await expect(loginPage.email.input).toHaveScreenshot('email-focused.png', SMALL_ELEMENT_BUDGET);
  });

  test('chat open', async ({ homePage }) => {
    await homePage.shell.chat.open();
    await expect(homePage.shell.chat.greeting).toBeVisible();
    await expect(homePage.shell.chat.window).toHaveScreenshot('chat.png', SMALL_ELEMENT_BUDGET);
  });

  test.describe('signed in (mocked session)', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', '/favorites', [])));

    test('account page', async ({ accountPage, page }) => {
      await expect(accountPage.title).toBeVisible();
      await settleImages(page);
      await expect(page).toHaveScreenshot('account.png');
    });
  });

  test.describe('back office (mocked admin)', { tag: ['@mocked'] }, () => {
    test('admin dashboard', async ({ adminDashboard, page }) => {
      await expect(adminDashboard.latestOrders.rows.first()).toBeVisible();
      // The chart animates on a canvas; CSS animation switches do not reach it.
      await settleImages(page);
      await expect(page).toHaveScreenshot('admin-dashboard.png', { mask: [adminDashboard.salesChart] });
    });

    test('admin orders list', async ({ adminOrders, backOffice, page }) => {
      await expect(adminOrders.table.row(backOffice.order.invoice_number)).toBeVisible();
      await settleImages(page);
      await expect(page).toHaveScreenshot('admin-orders.png', { fullPage: true });
    });

    test('admin order page', async ({ adminOrders, backOffice, page }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.lines.first()).toBeVisible();
      // The line carries a product from the real catalogue; its name is not what this shot is about.
      await settleImages(page);
      await expect(page).toHaveScreenshot('admin-order.png', { fullPage: true, mask: [order.lines] });
    });

    test('admin product form', async ({ adminProducts, backOffice, page }) => {
      const form = await adminProducts.edit(backOffice.product.id);
      await expect(form.name).toHaveValue(backOffice.product.name);
      // The form shows the product's id, which the self-hosted shop makes anew on every reseed.
      await settleImages(page);
      await expect(page).toHaveScreenshot('admin-product-form.png', { fullPage: true, mask: [form.chrome.id] });
    });
  });

  // Last in the file, but order does not matter: it reads the baselines on disk, not the run.
  test('every baseline on disk belongs to a screenshot in this file', async ({}, testInfo) => {
    // A name may be single- or double-quoted or a template literal; one built from an expression cannot be matched, so it is refused outright.
    const source = fs.readFileSync(testInfo.file, 'utf8');
    const named = [...source.matchAll(/toHaveScreenshot\(\s*(['"`])([^'"`]*)\1/g)].map((m) => m[2]);
    expect(named.filter((name) => name.includes('${')), 'screenshot names must be literal so the orphan check can read them').toEqual([]);
    expect(named, 'every toHaveScreenshot call names its file with a literal first argument').toHaveLength(source.match(/toHaveScreenshot\(/g)?.length ?? 0);
    const onDisk = fs.readdirSync(path.dirname(testInfo.snapshotPath('x.png'))).filter((f) => f.endsWith('.png'));

    expect(onDisk.filter((f) => !named.includes(f)), 'baselines no test compares against (delete them)').toEqual([]);
  });
});

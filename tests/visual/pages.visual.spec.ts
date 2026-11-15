import fs from 'node:fs';
import path from 'node:path';
import { expect, mock, test, withMocks } from '@fixtures';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * Screenshot comparisons of key pages and states. Baselines are recorded and compared only
 * inside the official Playwright image (scripts/visual.sh), against the freshly seeded
 * self-hosted shop, in Chromium at 1280×800: same fonts, same data, same pixels everywhere.
 * Animations are off; anything that can change between runs is masked. The default budget is
 * `maxDiffPixels` in playwright.config.ts; a small element shot, where 150 pixels would be a whole
 * button, sets a tighter one of its own.
 */
test.describe('Visual regression', { tag: ['@visual'] }, () => {
  test('home page', async ({ homePage, api, page }) => {
    // A full first page: as many cards as the API serves for it, so the shot is not taken mid-render.
    const firstPage = await api.listProducts();
    await expect(homePage.grid.cards).toHaveCount(firstPage.data.length);
    await expect(page).toHaveScreenshot('home.png', { fullPage: true, mask: [page.getByRole('slider')] });
  });

  test('product page', async ({ productPage, page }) => {
    await expect(productPage.relatedProducts.first()).toBeVisible();
    // Related products are picked by the API and their order varies.
    await expect(page).toHaveScreenshot('product.png', { fullPage: true, mask: [productPage.relatedProducts] });
  });

  test('category page', async ({ categoryPage, api, page }) => {
    // The shop's first top-level category, from its own tree: the same one on every freshly seeded shop.
    const [first] = await api.categoryTree();
    await categoryPage.open(first.slug);
    await expect(categoryPage.grid.cards.first()).toBeVisible();
    await expect(page).toHaveScreenshot('category.png', { fullPage: true });
  });

  test('rentals', async ({ rentalsPage, page }) => {
    await expect(rentalsPage.grid.cards.first()).toBeVisible();
    await expect(page).toHaveScreenshot('rentals.png', { fullPage: true });
  });

  test('contact form with errors', async ({ contactPage, page }) => {
    await contactPage.submit();
    await expect(contactPage.message.error).toBeVisible();
    await expect(page).toHaveScreenshot('contact-errors.png', { fullPage: true });
  });

  test('login with errors', async ({ loginPage, page }) => {
    await loginPage.loginButton.click();
    await expect(loginPage.password.error).toBeVisible();
    await expect(page).toHaveScreenshot('login-errors.png');
  });

  test('registration with errors', async ({ registerPage, page }) => {
    await registerPage.submit();
    await expect(registerPage.password.error).toBeVisible();
    await expect(page).toHaveScreenshot('register-errors.png', { fullPage: true });
  });

  test('cart with a product', async ({ checkout, page }) => {
    await expect(checkout.cart.table.rows).toHaveCount(1);
    await expect(page).toHaveScreenshot('cart.png');
  });

  test('checkout billing step', async ({ checkout, page }) => {
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
    await expect(checkout.billing.heading).toBeVisible();
    // The guest summary line carries the generated email.
    await expect(page).toHaveScreenshot('checkout-billing.png', { mask: [checkout.signIn.guestSummary] });
  });

  test.describe('out of stock', () => {
    test.use({ productKind: 'out-of-stock' });

    test('product out of stock', async ({ productPage, page }) => {
      await expect(productPage.outOfStock).toBeVisible();
      await expect(page).toHaveScreenshot('product-out-of-stock.png', { fullPage: true, mask: [productPage.relatedProducts] });
    });
  });

  test('checkout payment step', async ({ checkout, page }) => {
    await checkout.proceedToPayment(fakeGuest(), fakeAddress());
    await checkout.payment.choose('credit-card');
    await expect(checkout.payment.field('Credit Card Number')).toBeVisible();
    // The guest summary line carries the generated email.
    await expect(page).toHaveScreenshot('checkout-payment.png', { fullPage: true, mask: [checkout.signIn.guestSummary] });
  });

  test('chat open', async ({ homePage }) => {
    await homePage.shell.chat.open();
    await expect(homePage.shell.chat.greeting).toBeVisible();
    await expect(homePage.shell.chat.window).toHaveScreenshot('chat.png', { maxDiffPixels: 30 });
  });

  test.describe('signed in (mocked session)', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', '/favorites', [])));

    test('account page', async ({ accountPage, page }) => {
      await expect(accountPage.title).toBeVisible();
      await expect(page).toHaveScreenshot('account.png');
    });
  });

  test.describe('back office (mocked admin)', { tag: ['@mocked'] }, () => {
    test('admin dashboard', async ({ adminDashboard, page }) => {
      await expect(adminDashboard.latestOrders.rows.first()).toBeVisible();
      // The chart animates on a canvas; CSS animation switches do not reach it.
      await expect(page).toHaveScreenshot('admin-dashboard.png', { mask: [adminDashboard.salesChart] });
    });

    test('admin orders list', async ({ adminOrders, backOffice, page }) => {
      await expect(adminOrders.table.row(backOffice.order.invoice_number)).toBeVisible();
      await expect(page).toHaveScreenshot('admin-orders.png', { fullPage: true });
    });

    test('admin order page', async ({ adminOrders, backOffice, page }) => {
      const order = await adminOrders.edit(backOffice.order.invoice_number);
      await expect(order.lines.first()).toBeVisible();
      // The line carries a product from the real catalogue; its name is not what this shot is about.
      await expect(page).toHaveScreenshot('admin-order.png', { fullPage: true, mask: [order.lines] });
    });

    test('admin product form', async ({ adminProducts, backOffice, page }) => {
      const form = await adminProducts.edit(backOffice.product.id);
      await expect(form.name).toHaveValue(backOffice.product.name);
      // The form shows the product's id, which the self-hosted shop makes anew on every reseed.
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

import { expect, mock, test, withMocks } from '@fixtures';
import { fakeGuest } from '@support/test-data';

/**
 * Screenshot comparisons of key pages and states. Baselines are recorded and compared only
 * inside the official Playwright image (scripts/visual.sh), against the freshly seeded
 * self-hosted shop, in Chromium at 1280×800: same fonts, same data, same pixels everywhere.
 * Animations are off; anything that can change between runs is masked.
 */
test.describe('Visual regression', { tag: ['@visual'] }, () => {
  test('home page', async ({ homePage, page }) => {
    await expect(homePage.grid.cards).toHaveCount(9);
    await expect(page).toHaveScreenshot('home.png', { fullPage: true, mask: [page.getByRole('slider')] });
  });

  test('product page', async ({ productPage, page }) => {
    await expect(productPage.relatedProducts.first()).toBeVisible();
    // Related products are picked by the API and their order varies.
    await expect(page).toHaveScreenshot('product.png', { fullPage: true, mask: [productPage.relatedProducts] });
  });

  test('category page', async ({ categoryPage, page }) => {
    await categoryPage.open('hand-tools');
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

  test('chat open', async ({ homePage }) => {
    await homePage.shell.chat.open();
    await expect(homePage.shell.chat.greeting).toBeVisible();
    await expect(homePage.shell.chat.window).toHaveScreenshot('chat.png');
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

    test('admin product form', async ({ adminProducts, backOffice, page }) => {
      const form = await adminProducts.edit(backOffice.product.id);
      await expect(form.name).toHaveValue(backOffice.product.name);
      await expect(page).toHaveScreenshot('admin-product-form.png', { fullPage: true });
    });
  });
});

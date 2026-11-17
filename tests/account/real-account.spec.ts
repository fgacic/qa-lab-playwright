import { expect, test } from '@fixtures';
import { ACCOUNT_TITLE } from '@pages/account/AccountPage';
import { fakeAddress, fakeCustomer } from '@support/test-data';

/**
 * Against the real auth API: real registration, real sign-in, real account data. Runs on the
 * self-hosted Toolshop (our own environment) in every CI run; on the live site only with
 * RUN_ACCOUNT_TESTS=1, because it creates accounts on a public shop.
 */
test.describe('Real account', { tag: ['@account'] }, () => {
  // The customers made here stay behind: the shop's API has no call a customer can use to delete an account, and
  // the admin-side cleanup is not worth a session per test. Their emails are unique per run (`fakeCustomer`), so
  // they never collide, and a reset of the self-hosted database (see README) clears them.
  test.describe('a new customer', () => {
    // Starts signed out, whatever the project's storageState holds.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('registers, logs in with the new account and reaches the account area', { tag: ['@flow'] }, async ({ registerPage, page }) => {
      const customer = fakeCustomer();

      const loginPage = await registerPage.register(customer);
      await expect(page).toHaveURL('/auth/login');
      const account = await loginPage.login(customer.email, customer.password);

      await expect(account.title).toHaveText(ACCOUNT_TITLE);
      await expect(account.header.userMenu).toHaveText(`${customer.firstName} ${customer.lastName}`);
    });

    test('registering the same email twice is refused', { tag: ['@negative'] }, async ({ api, registerPage }) => {
      const customer = fakeCustomer();
      await api.registerCustomer(customer);

      await registerPage.register(customer);

      await expect(registerPage.error).toHaveText('A customer with this email address already exists.');
    });
  });

  test.describe('the saved session (storageState)', () => {
    test.use({ session: 'storage-state' });

    // A saved session that has lapsed is refused by the `session` fixture itself (fixtures/auth.ts), with the reason.
    test('opens the account area without signing in again', async ({ accountPage }) => {
      await expect(accountPage.title).toHaveText(ACCOUNT_TITLE);
      await expect(accountPage.header.userMenu).toBeVisible();
    });
  });

  test.describe("this worker's own customer", () => {
    // Each worker registers its own customer, so tests that change account data never collide.
    test.use({ session: 'worker-account' });

    test('a saved favourite is listed and can be removed', async ({ api, workerAccount, catalog, favoritesPage }) => {
      const product = await catalog.inStock();
      const { token } = await workerAccount.get();
      await api.addFavorite(token, product.id);
      await favoritesPage.open();

      await expect(favoritesPage.favorite(product.name)).toBeVisible();
      await favoritesPage.remove(product.name);

      await expect(favoritesPage.favorite(product.name)).toHaveCount(0);
      // Read back from the API: the UI could hide a favourite the account still holds.
      await expect.poll(() => api.favoriteProductIds(token), { message: 'the favourite is gone from the account' }).not.toContain(product.id);
    });

    test('a signed-in purchase skips the guest step and is saved to the account', { tag: ['@flow'] }, async ({ api, workerAccount, checkout }) => {
      await checkout.cart.proceed();
      await expect(checkout.signIn.guestTab, 'a signed-in customer is not offered the guest step').toBeHidden();
      await checkout.signIn.proceedSignedInButton.click();
      await checkout.billing.enterAddress(fakeAddress());
      await checkout.billing.proceed();
      await checkout.payment.payOnDelivery();

      await expect(checkout.wizard.confirmation).toContainText(/INV-\d+/);
      const invoiceNumber = await checkout.wizard.invoiceNumber();
      const { token } = await workerAccount.get();
      await expect.poll(() => api.invoiceNumbers(token), { message: `invoice ${invoiceNumber} is on the account` }).toContain(invoiceNumber);
    });
  });
});

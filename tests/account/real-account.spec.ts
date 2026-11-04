import { expect, test } from '@fixtures';
import { fakeAddress, fakeCustomer } from '@support/test-data';

/**
 * Against the real auth API: real registration, real sign-in, real account data. Runs on the
 * self-hosted Toolshop (our own environment) in every CI run; on the live site only with
 * RUN_ACCOUNT_TESTS=1, because it creates accounts on a public shop.
 */
test.describe('Real account', { tag: ['@account'] }, () => {
  test.describe('a new customer', () => {
    // Starts signed out, whatever the project's storageState holds.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('registers, logs in with the new account and reaches the account area', { tag: ['@flow'] }, async ({ registerPage, page }) => {
      const customer = fakeCustomer();

      const loginPage = await registerPage.register(customer);
      await expect(page).toHaveURL('/auth/login');
      const account = await loginPage.login(customer.email, customer.password);

      await expect(account.title).toHaveText('My account');
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

    test('opens the account area without signing in again', async ({ accountPage }) => {
      await expect(accountPage.title).toHaveText('My account');
      await expect(accountPage.header.userMenu).toBeVisible();
    });
  });

  test.describe("this worker's own customer", () => {
    // Each worker registers its own customer, so tests that change account data never collide.
    test.use({ session: 'worker-account' });

    test('a saved favourite is listed and can be removed', async ({ api, workerAccount, catalog, favoritesPage }) => {
      const product = await catalog.inStock();
      await api.addFavorite((await workerAccount.get()).token, product.id);
      await favoritesPage.open();

      await expect(favoritesPage.favorite(product.name)).toBeVisible();
      await favoritesPage.remove(product.name);

      await expect(favoritesPage.favorite(product.name)).toHaveCount(0);
    });

    test('a signed-in purchase skips the guest step and lands on the account', { tag: ['@flow'] }, async ({ signedIn: _, api, workerAccount, checkout }) => {
      // Reopen so the page is loaded with the session in place, whatever order fixtures ran in.
      await checkout.open();
      await checkout.cart.proceed();
      await checkout.signIn.proceedSignedInButton.click();
      await checkout.billing.enterAddress(fakeAddress());
      await checkout.billing.proceed();
      await checkout.payment.payWith('cash-on-delivery');

      await expect(checkout.wizard.confirmation).toBeVisible();
      const invoiceNumber = await checkout.wizard.invoiceNumber();
      expect(await api.invoiceNumbers((await workerAccount.get()).token)).toContain(invoiceNumber);
    });
  });
});

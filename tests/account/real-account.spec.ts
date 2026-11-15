import { expect, test } from '@fixtures';
import { API_URL, CUSTOMER_STORAGE_STATE } from '@support/env';
import { jwtExpiry } from '@support/payloads';
import { readSavedToken } from '@support/session';
import { fakeAddress, fakeCustomer } from '@support/test-data';

/** A saved session that is about to lapse would show up as a redirect to the login page, far from its cause. */
const MIN_SESSION_LEFT_SECONDS = 60;

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
      const secondsLeft = jwtExpiry(readSavedToken(CUSTOMER_STORAGE_STATE)) - Date.now() / 1000;
      expect(secondsLeft, 'saved session expired: run the session projects in their own pass (npm test does)').toBeGreaterThan(MIN_SESSION_LEFT_SECONDS);

      await expect(accountPage.title).toHaveText('My account');
      await expect(accountPage.header.userMenu).toBeVisible();
    });
  });

  test.describe("this worker's own customer", () => {
    // Each worker registers its own customer, so tests that change account data never collide.
    test.use({ session: 'worker-account' });

    test('a saved favourite is listed and can be removed', async ({ api, request, workerAccount, catalog, favoritesPage }) => {
      const product = await catalog.inStock();
      const { token } = await workerAccount.get();
      await api.addFavorite(token, product.id);
      await favoritesPage.open();
      // The account's own list, read back from the API (the UI could hide a favourite the account still holds).
      const favouriteIds = async () => {
        const response = await request.get(`${API_URL}/favorites`, { headers: { authorization: `Bearer ${token}` } });
        expect(response.ok(), 'GET /favorites answers').toBe(true);
        return ((await response.json()) as { product_id: string }[]).map((favourite) => favourite.product_id);
      };

      await expect(favoritesPage.favorite(product.name)).toBeVisible();
      await favoritesPage.remove(product.name);

      await expect(favoritesPage.favorite(product.name)).toHaveCount(0);
      await expect.poll(favouriteIds, { message: 'the favourite is gone from the account' }).not.toContain(product.id);
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

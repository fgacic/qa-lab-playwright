import { readFileSync } from 'node:fs';
import { expect, test } from '@fixtures';
import { CUSTOMER_STORAGE_STATE } from '@support/env';
import { jwtExpiry } from '@support/payloads';
import { TOKEN_KEY } from '@support/session';
import { fakeAddress, fakeCustomer } from '@support/test-data';

/** The token tests/setup/account.setup.ts saved, read from the file: the SPA drops an expired one as soon as a page opens. */
function savedToken(): string {
  const state = JSON.parse(readFileSync(CUSTOMER_STORAGE_STATE, 'utf8')) as { origins: { localStorage: { name: string; value: string }[] }[] };
  const token = state.origins.flatMap((origin) => origin.localStorage).find((item) => item.name === TOKEN_KEY)?.value;
  if (!token) throw new Error(`${CUSTOMER_STORAGE_STATE} holds no "${TOKEN_KEY}": the account setup did not save a session.`);
  return token;
}

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
      const secondsLeft = jwtExpiry(savedToken()) - Date.now() / 1000;
      expect(secondsLeft, 'saved session expired: run the session projects in their own pass (npm test does)').toBeGreaterThan(MIN_SESSION_LEFT_SECONDS);

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

    test('a signed-in purchase skips the guest step and lands on the account', { tag: ['@flow'] }, async ({ api, workerAccount, checkout }) => {
      await checkout.cart.proceed();
      await checkout.signIn.proceedSignedInButton.click();
      await checkout.billing.enterAddress(fakeAddress());
      await checkout.billing.proceed();
      await checkout.payment.payWith('cash-on-delivery');

      await expect(checkout.wizard.confirmation).toBeVisible();
      await expect(checkout.wizard.confirmation).toContainText(/INV-\d+/);
      const invoiceNumber = await checkout.wizard.invoiceNumber();
      const { token } = await workerAccount.get();
      await expect.poll(() => api.invoiceNumbers(token), { message: `invoice ${invoiceNumber} is on the account` }).toContain(invoiceNumber);
    });
  });
});

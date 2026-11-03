import { expect, test as setup } from '@fixtures';
import { ACCOUNT_SKIP_REASON, CUSTOMER_STORAGE_STATE, RUN_ACCOUNT_TESTS } from '@support/env';
import { fakeCustomer } from '@support/test-data';

/**
 * Signs a customer in through the UI once and saves the session for the `account` project.
 * Uses TOOLSHOP_EMAIL / TOOLSHOP_PASSWORD when set, otherwise registers a fresh fake customer.
 * Gated: this creates or uses a real account on the public shop.
 */
setup.skip(!RUN_ACCOUNT_TESTS, ACCOUNT_SKIP_REASON);

setup('sign in a customer and save the session', async ({ api, loginPage, page }) => {
  let email = process.env.TOOLSHOP_EMAIL;
  let password = process.env.TOOLSHOP_PASSWORD;
  if (!email || !password) {
    const customer = fakeCustomer();
    await api.registerCustomer(customer);
    ({ email, password } = customer);
  }

  const account = await loginPage.login(email, password);

  await expect(account.title).toHaveText('My account');
  await page.context().storageState({ path: CUSTOMER_STORAGE_STATE });
});

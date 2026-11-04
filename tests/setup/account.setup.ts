import { expect, test as setup } from '@fixtures';
import { ACCOUNT_SKIP_REASON, CUSTOMER_CREDENTIALS, CUSTOMER_STORAGE_STATE, RUN_ACCOUNT_TESTS } from '@support/env';
import { fakeCustomer } from '@support/test-data';

/**
 * Signs a customer in through the UI once and saves the session for the `account` project.
 * Uses TOOLSHOP_EMAIL / TOOLSHOP_PASSWORD when set, otherwise registers a fresh fake customer.
 * Always runs on the self-hosted target; on the live site only with RUN_ACCOUNT_TESTS=1.
 */
setup.skip(!RUN_ACCOUNT_TESTS, ACCOUNT_SKIP_REASON);

setup('sign in a customer and save the session', async ({ api, loginPage, page }) => {
  let { email, password } = CUSTOMER_CREDENTIALS;
  if (!email || !password) {
    const customer = fakeCustomer();
    await api.registerCustomer(customer);
    ({ email, password } = customer);
  }

  const account = await loginPage.login(email, password);

  await expect(account.title).toHaveText('My account');
  await page.context().storageState({ path: CUSTOMER_STORAGE_STATE });
});

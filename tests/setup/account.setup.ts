import { expect, test as setup } from '@fixtures';
import { CUSTOMER_CREDENTIALS, CUSTOMER_STORAGE_STATE } from '@support/env';
import { storedToken } from '@support/session';
import { fakeCustomer } from '@support/test-data';

/**
 * Signs a customer in through the UI once and saves the session for the `account` project.
 * Uses TOOLSHOP_EMAIL / TOOLSHOP_PASSWORD when set, otherwise registers a fresh fake customer.
 * Always runs on the self-hosted target; on the live site only with RUN_ACCOUNT_TESTS=1.
 * The saved token lives 300 s and the suite does not renew it (`GET /users/refresh` answers 500 when it gets no valid token, BUG-54), so the `account` specs that reuse it
 * must start soon after this runs; an expired one redirects them to the login page. Playwright
 * does not promise to run a setup project right before its dependants, so `npm test` and CI run
 * the real-session projects in a pass of their own.
 */
setup('sign in a customer and save the session', async ({ api, loginPage, page }) => {
  let { email, password } = CUSTOMER_CREDENTIALS;
  if (!email || !password) {
    const customer = fakeCustomer();
    await api.registerCustomer(customer);
    ({ email, password } = customer);
  }

  const account = await loginPage.login(email, password);

  await expect(account.title).toHaveText('My account');
  // The saved state is only worth keeping if it holds the session: a file with no token would send every account spec to the login page.
  await expect.poll(() => storedToken(page), { message: 'the sign-in stored a token' }).toBeTruthy();
  await page.context().storageState({ path: CUSTOMER_STORAGE_STATE });
});

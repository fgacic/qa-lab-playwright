import { expect, test as setup } from '@fixtures';
import { ADMIN_CREDENTIALS, ADMIN_SKIP_REASON, ADMIN_STORAGE_STATE, RUN_ADMIN_TESTS } from '@support/env';

/**
 * Signs the real admin in through the login page once and saves the session for the `admin`
 * project. On the self-hosted target it uses the seeded admin; on the live site it needs
 * RUN_ADMIN_TESTS=1 with ADMIN_EMAIL / ADMIN_PASSWORD.
 */
setup.skip(!RUN_ADMIN_TESTS, ADMIN_SKIP_REASON);

setup('sign in the admin and save the session', async ({ loginPage, page }) => {
  const { email, password } = ADMIN_CREDENTIALS;
  expect(email && password, 'ADMIN_EMAIL and ADMIN_PASSWORD must be set').toBeTruthy();

  await loginPage.login(email!, password!);

  await expect(page).toHaveURL('/admin/dashboard');
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});

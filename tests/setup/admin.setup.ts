import { expect, test as setup } from '@fixtures';
import { ADMIN_CREDENTIALS, ADMIN_STORAGE_STATE } from '@support/env';
import { storedToken } from '@support/session';

/**
 * Signs the real admin in through the login page once and saves the session for the `admin`
 * project. On the self-hosted target it uses the seeded admin; on the live site it needs
 * RUN_ADMIN_TESTS=1 with ADMIN_EMAIL / ADMIN_PASSWORD.
 * The `admin` project depends on this one because its `storageState` is the file written here: without the setup the file
 * does not exist (or is a stale one from an earlier run) and every real-admin spec would start signed out.
 */
setup('sign in the admin and save the session', async ({ loginPage, page }) => {
  const { email, password } = ADMIN_CREDENTIALS;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set.');

  await loginPage.login(email, password);

  await expect(page).toHaveURL('/admin/dashboard');
  // The saved state is only worth keeping if it holds the session: a file with no token would send every admin spec to the login page.
  await expect.poll(() => storedToken(page), { message: 'the sign-in stored a token' }).toBeTruthy();
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});

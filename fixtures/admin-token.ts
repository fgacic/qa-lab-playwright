import { ADMIN_CREDENTIALS } from '@support/env';
import { test as apiTest } from './api';

export interface AdminTokenFixtures {
  /** Signs the real admin in through the API (once per test, on first use) and returns a fresh token, for arranging and cleaning up. */
  adminToken: () => Promise<string>;
}

/**
 * Its own module so the browserless `apiOnlyTest` (fixtures/index.ts) can use the token without the admin page
 * fixtures, which need a `page`. The browser `test` gets the same fixture through fixtures/admin.ts.
 */
export const test = apiTest.extend<AdminTokenFixtures>({
  // No runtime skip here: specs that need a real admin carry @admin, and the `admin` project that
  // runs them is only scheduled where a real admin may be used (playwright.config.ts).
  adminToken: async ({ api }, use) => {
    const { email, password } = ADMIN_CREDENTIALS;
    if (!email || !password) throw new Error('No admin credentials: set ADMIN_EMAIL and ADMIN_PASSWORD (the self-hosted shop is seeded with its own admin).');
    // Lazy, so mocked specs never sign in; one login per test. A login that failed is not remembered: the next call tries again.
    let token: Promise<string> | undefined;
    await use(() => (token ??= api.login(email, password).catch((error: unknown) => {
      token = undefined;
      throw error;
    })));
  },
});

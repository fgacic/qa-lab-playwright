import { mergeTests } from '@playwright/test';
import { AccountPage } from '@pages/account/AccountPage';
import { FavoritesPage } from '@pages/account/FavoritesPage';
import { InvoicesPage } from '@pages/account/InvoicesPage';
import { MessagesPage } from '@pages/account/MessagesPage';
import { ProfilePage } from '@pages/account/ProfilePage';
import { mock } from '@support/api-mock';
import { ACCOUNT_SKIP_REASON, CUSTOMER_CREDENTIALS, RUN_ACCOUNT_TESTS } from '@support/env';
import { fakeJwt, fakeUser } from '@support/payloads';
import { installToken } from '@support/session';
import { fakeCustomer, type Customer } from '@support/test-data';
import { test as apiTest } from './api';
import { test as mocksTest } from './mocks';

/**
 * How the browser is signed in:
 * - `mocked`: a fake token plus a mocked GET /users/me. Nothing reaches the real auth API,
 *   so these specs run everywhere. The spec mocks the data endpoints it needs.
 * - `storage-state`: the token saved by tests/setup/account.setup.ts (gated, `account` project).
 * - `worker-account`: a real customer of this worker's own (gated).
 */
export type Session = 'mocked' | 'storage-state' | 'worker-account';

export interface AuthOptions {
  session: Session;
}

export interface AuthFixtures {
  /** The customer the browser is signed in as. Account page fixtures depend on it. */
  signedIn: { firstName: string; lastName: string; email: string };
  accountPage: AccountPage;
  favoritesPage: FavoritesPage;
  invoicesPage: InvoicesPage;
  messagesPage: MessagesPage;
  profilePage: ProfilePage;
}

export interface AuthWorkerFixtures {
  /**
   * A real customer per worker, so parallel workers never share (and fight over) one account.
   * Registered through the API on first use only, so mocked specs never trigger it.
   */
  workerAccount: { get: () => Promise<{ customer: Customer; token: string }> };
}

export const test = mergeTests(apiTest, mocksTest).extend<AuthOptions & AuthFixtures, AuthWorkerFixtures>({
  session: ['mocked', { option: true }],

  workerAccount: [
    async ({ api }, use) => {
      let registered: Promise<Customer> | undefined;
      const register = async () => {
        const customer = fakeCustomer();
        await api.registerCustomer(customer);
        return customer;
      };
      // Registered once per worker; the token is issued fresh on every call, because
      // Toolshop's JWT lives 300 s and /users/refresh cannot renew it.
      await use({
        get: async () => {
          const customer = await (registered ??= register());
          return { customer, token: await api.login(customer.email, customer.password) };
        },
      });
    },
    { scope: 'worker' },
  ],

  signedIn: async ({ page, session, apiMock, workerAccount }, use, testInfo) => {
    if (session === 'mocked') {
      await installToken(page, fakeJwt());
      await apiMock.use(mock.respond('GET', '/users/me', fakeUser));
      await use({ firstName: fakeUser.first_name, lastName: fakeUser.last_name, email: fakeUser.email });
      return;
    }
    testInfo.skip(!RUN_ACCOUNT_TESTS, ACCOUNT_SKIP_REASON);
    if (session === 'worker-account') {
      const { customer, token } = await workerAccount.get();
      await installToken(page, token);
      await use(customer);
      return;
    }
    // storage-state: the account project's storageState already holds the token.
    await use({ firstName: '', lastName: '', email: CUSTOMER_CREDENTIALS.email ?? '' });
  },

  // Depends on `signedIn` so the session exists before the page opens.
  accountPage: async ({ page, signedIn: _ }, use) => {
    const accountPage = new AccountPage(page);
    await accountPage.open();
    await use(accountPage);
  },
  // Depends on `signedIn` so the session exists before the page opens.
  favoritesPage: async ({ page, signedIn: _ }, use) => {
    const favoritesPage = new FavoritesPage(page);
    await favoritesPage.open();
    await use(favoritesPage);
  },
  // Depends on `signedIn` so the session exists before the page opens.
  invoicesPage: async ({ page, signedIn: _ }, use) => {
    const invoicesPage = new InvoicesPage(page);
    await invoicesPage.open();
    await use(invoicesPage);
  },
  // Depends on `signedIn` so the session exists before the page opens.
  messagesPage: async ({ page, signedIn: _ }, use) => {
    const messagesPage = new MessagesPage(page);
    await messagesPage.open();
    await use(messagesPage);
  },
  // Depends on `signedIn` so the session exists before the page opens.
  profilePage: async ({ page, signedIn: _ }, use) => {
    const profilePage = new ProfilePage(page);
    await profilePage.open();
    await use(profilePage);
  },
});

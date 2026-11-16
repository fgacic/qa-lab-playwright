import { mergeTests } from '@playwright/test';
import { AccountPage } from '@pages/account/AccountPage';
import { FavoritesPage } from '@pages/account/FavoritesPage';
import { InvoicesPage } from '@pages/account/InvoicesPage';
import { MessagesPage } from '@pages/account/MessagesPage';
import { ProfilePage } from '@pages/account/ProfilePage';
import { mock } from '@support/api-mock';
import { CUSTOMER_STORAGE_STATE } from '@support/env';
import { fakeJwt, fakeUser, jwtExpiry } from '@support/payloads';
import { installToken, readSavedToken } from '@support/session';
import { fakeCustomer, type Customer } from '@support/test-data';
import { test as apiTest } from './api';
import { test as mocksTest } from './mocks';

/**
 * How the browser is signed in:
 * - `mocked`: a fake token plus a mocked GET /users/me. Nothing reaches the real auth API,
 *   so these specs run everywhere. The spec mocks the data endpoints it needs.
 * - `storage-state`: the token saved by tests/setup/account.setup.ts (`account` project only).
 * - `worker-account`: a real customer of this worker's own (`account` project only).
 */
export type Session = 'mocked' | 'storage-state' | 'worker-account';

/** A saved token with less than this left is treated as expired. */
const TOKEN_EXPIRY_MARGIN_S = 60;

export interface AuthOptions {
  session: Session;
}

export interface AuthFixtures {
  /**
   * The customer the browser is signed in as. Account page fixtures depend on it.
   * In `storage-state` the session is whatever tests/setup/account.setup.ts saved and is never
   * refreshed (the JWT lives 300 s and cannot be renewed), so the `account` project has to run in
   * a pass of its own, right after its setup; the names are read from `GET /users/me` with that token.
   * `worker-account` issues a fresh token per test.
   * Only the test that proves a saved session opens the account area uses `storage-state`: every
   * other real session uses `worker-account`, so no spec depends on how long ago the setup ran.
   */
  signedIn: { firstName: string; lastName: string; email: string };
  /** Registers a brand-new customer for this test through the API and returns it with a fresh token: state it changes is nobody else's. Self-hosted only. */
  newAccount: () => Promise<NewAccount>;
  accountPage: AccountPage;
  favoritesPage: FavoritesPage;
  invoicesPage: InvoicesPage;
  messagesPage: MessagesPage;
  profilePage: ProfilePage;
}

export interface NewAccount {
  customer: Customer;
  token: string;
}

export interface AuthWorkerFixtures {
  /**
   * A real customer per worker, so parallel workers never share (and fight over) one account.
   * Registered through the API on first use only, so mocked specs never trigger it, and a registration that failed is
   * not remembered: the next call registers again. The accounts are never deleted: the API has no customer delete,
   * and the self-hosted database is created per CI job and reset locally by `npm run toolshop:reseed`, so they
   * disappear with it. It registers on the self-hosted shop only.
   *
   * The tests of one worker run one after another on the SAME account, so it is for tests that only read it or that
   * add something they find again by a unique key (an invoice number). A test that changes what the next one would
   * see (favourites, the profile, a password) takes `newAccount` instead.
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
      // A rejected registration is dropped, not cached: one failed call must not fail every later test of the worker.
      const registeredOnce = () =>
        (registered ??= register().catch((error: unknown) => {
          registered = undefined;
          throw error;
        }));
      // Registered once per worker; the token is issued fresh on every call, because
      // Toolshop's JWT lives 300 s and /users/refresh cannot renew it.
      await use({
        get: async () => {
          const customer = await registeredOnce();
          return { customer, token: await api.login(customer.email, customer.password) };
        },
      });
    },
    { scope: 'worker' },
  ],

  newAccount: async ({ api }, use) => {
    await use(async () => {
      const customer = fakeCustomer();
      await api.registerCustomer(customer);
      return { customer, token: await api.login(customer.email, customer.password) };
    });
  },

  signedIn: async ({ page, session, apiMock, workerAccount, api }, use) => {
    if (session === 'mocked') {
      await installToken(page, fakeJwt());
      // A default, not a mock of its own: a spec that tests /users/me (a 401, a changed profile) overrides it.
      await apiMock.useDefaults(mock.respond('GET', '/users/me', fakeUser));
      await use({ firstName: fakeUser.first_name, lastName: fakeUser.last_name, email: fakeUser.email });
      return;
    }
    // No runtime skip for the real sessions: playwright.config.ts schedules @account specs only
    // in the `account` project, which exists only where real accounts may be created.
    if (session === 'worker-account') {
      const { customer, token } = await workerAccount.get();
      await installToken(page, token);
      await use(customer);
      return;
    }
    // storage-state: the account project's storageState already holds the token, which is deliberately
    // not replaced: the point of this session is that a SAVED sign-in opens the account area.
    const token = readSavedToken(CUSTOMER_STORAGE_STATE);
    // A margin: a token that expires mid-test is a failure with a misleading cause, so refuse one that is about to.
    if (jwtExpiry(token) <= Date.now() / 1000 + TOKEN_EXPIRY_MARGIN_S) throw new Error('The saved session has expired or is about to (it lives 300 s): run the session projects in their own pass, right after their setup (npm test and the CI `sessions` job do).');
    const me = await api.me(token);
    await use({ firstName: me.first_name, lastName: me.last_name, email: me.email });
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

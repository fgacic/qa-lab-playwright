import { expect, test } from '@fixtures';
import { ADMIN_ADDRESSES } from '@pages/admin/AdminPages';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/**
 * What only the back office reads: orders, the inbox, the reports and the user records (the SPA itself asks for `/users/me` and, signed out,
 * `/users/refresh`, so those two are not admin endpoints). A visitor turned away at the door must not have caused any of these.
 */
const ADMIN_ONLY_ENDPOINTS = /^\/(?:invoices|messages|reports)(?:\/.*)?$|^\/users\/(?!me$|refresh$).+$|^\/users$/;

/**
 * The route guard of the single-page app, for every address of the back office (the SPA's own guard: the API's
 * authorisation is in tests/security). Whoever is not the admin lands on the sign-in page, and the page behind the guard asked
 * for nothing. A customer is signed in with a mocked session and an anonymous visitor has none, so these prove the UI and not the real backend.
 */
test.describe('Admin access control (mocked sessions)', { tag: ['@mocked', '@negative'] }, () => {
  test.describe('a signed-in customer', () => {
    for (const address of ADMIN_ADDRESSES) {
      test(`cannot open ${address}`, async ({ signedIn: _, adminEntrance, page, apiMock }) => {
        await adminEntrance.tryToOpen(address);

        await expect(page, `${address} sends a customer to the sign-in page`).toHaveURL('/auth/login');
        await expect(apiMock.expectNoRequest('GET', ADMIN_ONLY_ENDPOINTS), 'no admin endpoint was called for a customer').resolves.toBeUndefined();
      });
    }
  });

  // BUG-01 is the same for a signed-out visitor (tests/navigation/routing). Every address below it is guarded; the bare /admin is not.
  test('a signed-in customer who opens /admin is sent to the sign-in page', { tag: ['@bug'] }, async ({ signedIn: _, adminEntrance, page }) => {
    knownBug('ADM-24', 'a signed-in customer who opens /admin keeps that URL and gets an empty page, while every address below it (/admin/dashboard ...) sends them to the sign-in page.');
    await adminEntrance.tryToOpen('/admin');

    await expect(page, 'ADM-24: /admin sends a customer to the sign-in page').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
  });

  test.describe('a visitor who is not signed in', () => {
    for (const address of ADMIN_ADDRESSES) {
      test(`cannot open ${address}`, async ({ adminEntrance, page, apiMock, consoleGuard }) => {
        consoleGuard.allow(/^Failed to load resource: the server responded with a status of 500\b/, 'BUG-54: the guard asks GET /users/refresh with no token, which answers 500 (the suite-wide allowance covers /account and the login page only)');
        await adminEntrance.tryToOpen(address);

        await expect(page, `${address} sends a signed-out visitor to the sign-in page`).toHaveURL('/auth/login');
        await expect(apiMock.expectNoRequest('GET', ADMIN_ONLY_ENDPOINTS), 'no admin endpoint was called for a signed-out visitor').resolves.toBeUndefined();
      });
    }
  });
});

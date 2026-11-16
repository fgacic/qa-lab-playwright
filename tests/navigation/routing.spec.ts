import { expect, test } from '@fixtures';
import { RegisterPage } from '@pages/RegisterPage';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

test.describe('Routing', () => {
  const accountRoutes = ['/account', '/account/favorites', '/account/profile', '/account/invoices', '/account/messages'];

  for (const route of accountRoutes) {
    test(`${route} sends a signed-out visitor to the login page`, { tag: ['@negative'] }, async ({ shop, page }) => {
      await shop.appShell.goto(route);

      await expect(page).toHaveURL('/auth/login');
      await expect(shop.login.heading).toBeVisible();
    });
  }

  test('/admin sends a signed-out visitor to the login page', { tag: ['@negative', '@bug'] }, async ({ shop, page }) => {
    knownBug('BUG-01', '/admin keeps its URL and renders an empty page instead of redirecting to login.');
    await shop.appShell.goto('/admin');

    await expect(page, 'BUG-01: /admin redirects to the login page').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
  });

  test('an unknown route lands on a working home page', { tag: ['@negative', '@bug'] }, async ({ page, shop }) => {
    knownBug('BUG-02', 'an unknown route redirects to / but the product grid never renders.', { absence: true });
    await shop.appShell.goto('/this/route/does/not/exist');
    await expect(page).toHaveURL('/');
    // The page around the grid is there, so the grid's absence below is the defect and not a page that never loaded.
    await expect(shop.home.shell.header.brandLink).toBeVisible();

    await expect(shop.home.grid.cards.first(), 'BUG-02: the product grid renders').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  // Unknown routes redirect to the home page (BUG-02 is about the grid that page then fails to show).
  // This test asserts only the redirect and the header, so fixing that bug cannot change it.
  test('/compare, which is not a page, redirects to the home page', { tag: ['@negative'] }, async ({ page, shop }) => {
    await shop.appShell.goto('/compare');

    await expect(page).toHaveURL('/');
    await expect(shop.home.shell.header.brandLink).toBeVisible();
  });

  // The mocked session (a fake token and a mocked GET /users/me) is enough: the page decides on the token it holds, and nothing is
  // written. The pages are opened by the tests, after the session is in place (a page fixture would open them first).
  test.describe('a signed-in customer opens an auth page', { tag: ['@negative', '@bug'] }, () => {
    test('/auth/login does not show the login form again', async ({ signedIn: _, shop, page }) => {
      knownBug('BUG-64', 'a signed-in customer who opens /auth/login is shown the login form instead of being sent on to the account.');
      await shop.login.open();
      // Precondition, true whether or not the bug is fixed: the customer is signed in (the account menu is in the header).
      await expect(shop.login.shell.header.userMenu).toBeVisible();

      await expect(shop.login.heading, 'BUG-64: the login form is not offered to a signed-in customer').toBeHidden({ timeout: BUG_TIMEOUT });
      await expect(page, 'BUG-64: the signed-in customer is sent away from /auth/login').not.toHaveURL('/auth/login');
    });

    test('/auth/register does not show the registration form again', async ({ signedIn: _, shop, page }) => {
      knownBug('BUG-65', 'a signed-in customer who opens /auth/register is shown the registration form instead of being sent on to the account.');
      const register = new RegisterPage(page);
      await register.open();
      // Precondition, true whether or not the bug is fixed: the customer is signed in (the account menu is in the header).
      await expect(shop.login.shell.header.userMenu).toBeVisible();

      await expect(register.heading, 'BUG-65: the registration form is not offered to a signed-in customer').toBeHidden({ timeout: BUG_TIMEOUT });
      await expect(page, 'BUG-65: the signed-in customer is sent away from /auth/register').not.toHaveURL('/auth/register');
    });
  });
});

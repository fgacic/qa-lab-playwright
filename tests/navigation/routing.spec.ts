import { expect, test } from '@fixtures';
import { AppShell } from '@pages/AppShell';
import { LoginPage } from '@pages/LoginPage';
import { knownBug } from '@support/known-bug';

test.describe('Routing', () => {
  const accountRoutes = ['/account', '/account/favorites', '/account/profile', '/account/invoices', '/account/messages'];

  for (const route of accountRoutes) {
    test(`${route} sends a signed-out visitor to the login page`, { tag: ['@negative'] }, async ({ page }) => {
      await new AppShell(page).goto(route);

      await expect(page).toHaveURL('/auth/login');
      await expect(new LoginPage(page).heading).toBeVisible();
    });
  }

  test('/admin sends a signed-out visitor to the login page', { tag: ['@negative', '@bug'] }, async ({ page }) => {
    knownBug('BUG-01', '/admin keeps its URL and renders an empty page instead of redirecting to login.');
    await new AppShell(page).goto('/admin');

    await expect(page, 'BUG-01: /admin redirects to the login page').toHaveURL('/auth/login', { timeout: 8_000 });
  });

  test('an unknown route lands on a working home page', { tag: ['@negative', '@bug'] }, async ({ page, shop }) => {
    knownBug('BUG-02', 'an unknown route redirects to / but the product grid never renders.');
    await new AppShell(page).goto('/this/route/does/not/exist');
    await expect(page).toHaveURL('/');

    await expect(shop.home.grid.cards.first(), 'BUG-02: the product grid renders').toBeVisible({ timeout: 8_000 });
  });

  // Unknown routes redirect to the home page (BUG-02 is about the grid that page then fails to show).
  // This test asserts only the redirect and the header, so fixing that bug cannot change it.
  test('/compare is not a page: the comparison lives at /comparison', { tag: ['@negative'] }, async ({ page, shop }) => {
    await new AppShell(page).goto('/compare');

    await expect(page).toHaveURL('/');
    await expect(shop.home.shell.header.brandLink).toBeVisible();
  });
});

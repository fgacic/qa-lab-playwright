import { expect, test } from '@fixtures';
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
});

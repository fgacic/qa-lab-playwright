import { expect, test } from '@fixtures';

/**
 * External links are checked by their href, target and rel rather than followed: following
 * them would test someone else's site, and a new tab would only prove the browser works.
 */
test.describe('Banners and footer', () => {
  test('the notification bar links to the documentation in a new tab', async ({ homePage }) => {
    const link = homePage.shell.banners.documentationLink;

    await expect(link).toHaveAttribute('href', 'https://testsmith-io.github.io/practice-software-testing/#/');
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('the course promo links to the courses with campaign tracking', async ({ homePage }) => {
    const link = homePage.shell.banners.coursePromoLink;

    await expect(link).toHaveAttribute('href', /^https:\/\/onlinecourses\.testsmith\.io\/\?utm_source=pst&utm_medium=homepage&utm_campaign=app_promo$/);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  const footerLinks = [
    { link: 'coursesLink', href: 'https://onlinecourses.testsmith.io' },
    { link: 'apiSpectorLink', href: 'https://api-spector.dev' },
    { link: 'githubLink', href: 'https://github.com/testsmith-io/practice-software-testing' },
  ] as const;

  for (const { link, href } of footerLinks) {
    test(`the footer links to ${href} in a new tab without an opener`, async ({ homePage }) => {
      const locator = homePage.shell.footer[link];

      await expect(locator).toHaveAttribute('href', href);
      await expect(locator).toHaveAttribute('target', '_blank');
      await expect(locator).toHaveAttribute('rel', /noopener/);
    });
  }

  test('the footer opens the privacy policy', async ({ homePage, page }) => {
    await homePage.shell.footer.openPrivacyPolicy();

    await expect(page).toHaveURL('/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy for Toolshop' })).toBeVisible();
  });

  test('the testing guide opens, pages forward and back, and closes on Escape', async ({ homePage, page }) => {
    const { banners } = homePage.shell;
    await banners.openTestingGuide();
    await expect(banners.guide).toBeVisible();
    await expect(banners.guideProgress).toHaveText(/^Step 1 of \d+$/);
    await expect(banners.guidePrevious).toBeDisabled();

    await banners.guideNext.click();
    await expect(banners.guideProgress).toHaveText(/^Step 2 of \d+$/);
    await banners.guidePrevious.click();
    await expect(banners.guideProgress).toHaveText(/^Step 1 of \d+$/);

    await page.keyboard.press('Escape');
    await expect(banners.guide).toBeHidden();
  });
});

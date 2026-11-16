import { expect, test } from '@fixtures';

const EXTERNAL_LINKS = {
  documentation: 'https://testsmith-io.github.io/practice-software-testing/#/',
  courses: 'https://onlinecourses.testsmith.io',
  coursePromo: 'https://onlinecourses.testsmith.io/?utm_source=pst&utm_medium=homepage&utm_campaign=app_promo',
  apiSpector: 'https://api-spector.dev',
  github: 'https://github.com/testsmith-io/practice-software-testing',
} as const;

/**
 * External links are checked by their href, target and rel rather than followed: following
 * them would test someone else's site, and a new tab would only prove the browser works.
 * The documentation link has no rel: not pinned as a bug, because every current browser
 * treats target=_blank as noopener already.
 */
test.describe('Banners and footer', () => {
  test('the notification bar links to the documentation in a new tab', async ({ homePage }) => {
    const link = homePage.shell.banners.documentationLink;

    await expect(link).toHaveAttribute('href', EXTERNAL_LINKS.documentation);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('the course promo links to the courses with campaign tracking, without an opener', async ({ homePage }) => {
    const link = homePage.shell.banners.coursePromoLink;

    await expect(link).toHaveAttribute('href', EXTERNAL_LINKS.coursePromo);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  const footerLinks = [
    { link: 'coursesLink', href: EXTERNAL_LINKS.courses },
    { link: 'apiSpectorLink', href: EXTERNAL_LINKS.apiSpector },
    { link: 'githubLink', href: EXTERNAL_LINKS.github },
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
    const privacy = await homePage.shell.openPrivacyPolicy();

    await expect(page).toHaveURL('/privacy');
    await expect(privacy.heading).toBeVisible();
  });

  test('the testing guide opens and pages forward and back', async ({ homePage }) => {
    const { banners } = homePage.shell;
    await banners.openTestingGuide();
    await expect(banners.guide).toBeVisible();
    await expect(banners.guideProgress).toHaveText(/^Step 1 of \d+$/);
    await expect(banners.guidePrevious).toBeDisabled();

    await banners.guideNext.click();
    await expect(banners.guideProgress).toHaveText(/^Step 2 of \d+$/);
    await banners.guidePrevious.click();
    await expect(banners.guideProgress).toHaveText(/^Step 1 of \d+$/);
  });

  test('the testing guide closes on Escape', async ({ homePage, page }) => {
    const { banners } = homePage.shell;
    await banners.openTestingGuide();
    await expect(banners.guide).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(banners.guide).toBeHidden();
  });
});

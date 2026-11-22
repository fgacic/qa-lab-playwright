import { expect, test } from '@fixtures';
import { httpsUrl } from '@support/urls';

const EXTERNAL_LINKS = {
  documentation: httpsUrl('testsmith-io.github.io', '/practice-software-testing/#/'),
  courses: httpsUrl('onlinecourses.testsmith.io'),
  coursePromo: httpsUrl('onlinecourses.testsmith.io', '/?utm_source=pst&utm_medium=homepage&utm_campaign=app_promo'),
  apiSpector: httpsUrl('api-spector.dev'),
  github: httpsUrl('github.com', '/testsmith-io/practice-software-testing'),
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

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', EXTERNAL_LINKS.documentation);
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('the course promo links to the courses with campaign tracking, without an opener', async ({ homePage }) => {
    const link = homePage.shell.banners.coursePromoLink;

    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', EXTERNAL_LINKS.coursePromo);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
  });

  const footerLinks = [
    { name: 'online courses', link: 'coursesLink', href: EXTERNAL_LINKS.courses },
    { name: 'API Spector', link: 'apiSpectorLink', href: EXTERNAL_LINKS.apiSpector },
    { name: 'GitHub repository', link: 'githubLink', href: EXTERNAL_LINKS.github },
  ] as const;

  for (const { name, link, href } of footerLinks) {
    test(`the footer links to ${name} in a new tab without an opener`, async ({ homePage }) => {
      const locator = homePage.shell.footer[link];

      await expect(locator).toBeVisible();
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
    await expect(banners.guideStep(1)).toBeVisible();
    await expect(banners.guidePrevious).toBeDisabled();

    await banners.guideNext.click();
    await expect(banners.guideStep(2)).toBeVisible();
    await banners.guidePrevious.click();
    await expect(banners.guideStep(1)).toBeVisible();
  });

  test('on the last step of the testing guide there is no way forward', { tag: ['@negative'] }, async ({ homePage }) => {
    const { banners } = homePage.shell;
    await banners.openTestingGuide();
    await expect(banners.guideStep(1)).toBeVisible();
    // The count is read after the progress line has said it (guideStepCount waits for that), so it is a total and not a half-drawn line.
    const last = await banners.guideStepCount();
    for (let step = 2; step <= last; step++) {
      await banners.guideNext.click();
      await expect(banners.guideStep(step)).toBeVisible();
    }

    await expect(banners.guideNext).toBeDisabled();
    await expect(banners.guideStep(last)).toBeVisible();
  });

  test('the testing guide closes on Escape', async ({ homePage, page }) => {
    const { banners } = homePage.shell;
    await banners.openTestingGuide();
    await expect(banners.guide).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(banners.guide).toBeHidden();
  });
});

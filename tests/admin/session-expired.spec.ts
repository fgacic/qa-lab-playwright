import { expect, mock, test } from '@fixtures';
import { ADM_25, withLoggedFailure } from '@pages/admin/alerts';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

const UNAUTHORIZED = { message: 'Unauthorized' };

/**
 * An expired session on the back-office pages that are not lists: the dashboard, the statistics, the two sales reports, and the save of a form.
 * The session the admin signed in with is refused while the page is open; a fixed back office signs the admin out and shows the sign-in page.
 */
test.describe('Admin pages on an expired session (mocked back office)', { tag: ['@mocked', '@negative', '@bug'] }, () => {
  test.describe('dashboard', () => {
    test.use(withLoggedFailure(mock.fail('GET', '/invoices', 401, UNAUTHORIZED), mock.fail('GET', '/reports/total-sales-of-years', 401, UNAUTHORIZED)));

    test('an expired session on the dashboard sends the admin to the sign-in page', async ({ adminDashboard, page }) => {
      knownBug('ADM-25', ADM_25);
      await expect(adminDashboard.salesHeading).toBeVisible();

      await expect(page, 'ADM-25: a refused session sends the admin to the sign-in page').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
    });
  });

  test.describe('statistics', () => {
    test.use(withLoggedFailure(mock.fail('GET', /^\/reports\/[^/]+$/, 401, UNAUTHORIZED)));

    test('an expired session on the statistics sends the admin to the sign-in page', async ({ adminStatistics, page }) => {
      knownBug('ADM-25', ADM_25);
      await expect(adminStatistics.heading).toBeVisible();

      await expect(page, 'ADM-25: a refused session sends the admin to the sign-in page').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
    });
  });

  for (const period of ['month', 'week'] as const) {
    test.describe(`average sales per ${period}`, () => {
      test.use({ adminSalesPeriod: period, ...withLoggedFailure(mock.fail('GET', /^\/reports\/[^/]+$/, 401, UNAUTHORIZED)) });

      test(`an expired session on the sales per ${period} sends the admin to the sign-in page`, async ({ adminSalesReport, page }) => {
        knownBug('ADM-25', ADM_25);
        await expect(adminSalesReport.heading).toBeVisible();

        await expect(page, 'ADM-25: a refused session sends the admin to the sign-in page').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
      });
    });
  }

  test.describe('a form save', () => {
    test.use(withLoggedFailure(mock.fail('POST', '/brands', 401, UNAUTHORIZED)));

    test('an expired session when a brand is saved sends the admin to the sign-in page', async ({ adminBrands, apiMock, page }) => {
      knownBug('ADM-25', ADM_25);
      const form = await adminBrands.add();
      const refused = apiMock.waitForResponse('POST', '/brands');
      await form.fillIn({ name: 'Qa Lab Expired', slug: 'qa-lab-expired' });

      await form.chrome.save();

      expect((await refused).response.status(), 'the save was refused with 401').toBe(401);
      await expect(page, 'ADM-25: a refused session sends the admin to the sign-in page').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
    });
  });
});

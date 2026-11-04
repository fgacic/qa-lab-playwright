import { ADMIN_SECTIONS } from '@components/Header';
import { expect, mock, test, withMocks } from '@fixtures';
import { paginated } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

/**
 * Back office with a mocked admin session and a mocked admin API (fixtures/admin.ts). These
 * specs prove how the UI behaves on given responses; they do not prove the real backend.
 * The real journeys are tests/admin-e2e, against the self-hosted Toolshop.
 */
test.describe('Admin dashboard and menu (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the dashboard shows the sales chart and the orders awaiting fulfilment', async ({ adminDashboard, backOffice }) => {
    await expect(adminDashboard.salesHeading).toBeVisible();
    await expect(adminDashboard.salesChart).toBeVisible();
    await expect(adminDashboard.latestOrders.row(backOffice.order.invoice_number)).toContainText('AWAITING_FULFILLMENT');
  });

  test('an order on the dashboard opens for editing', async ({ adminDashboard, backOffice, page }) => {
    await adminDashboard.latestOrders.edit(backOffice.order.invoice_number);

    await expect(page).toHaveURL(`/admin/orders/edit/${backOffice.order.id}`);
  });

  test('the admin menu reaches every back-office section', async ({ adminDashboard, page }) => {
    for (const section of ADMIN_SECTIONS) {
      await adminDashboard.shell.header.openAdminSection(section);
      await expect(page).toHaveURL(`/admin/${section.toLowerCase()}`);
    }
  });

  test.describe('with no orders waiting', () => {
    test.use(withMocks(mock.respond('GET', '/invoices', paginated([]))));

    test('the latest-orders table is empty', async ({ adminDashboard }) => {
      await expect(adminDashboard.salesHeading).toBeVisible();
      await expect(adminDashboard.latestOrders.rows).toHaveCount(0);
    });
  });

  test.describe('when the dashboard data fails to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/invoices', 500), mock.fail('GET', '/reports/total-sales-of-years', 500)));

    test('the admin is told the dashboard could not be loaded', async ({ adminDashboard }) => {
      knownBug('ADM-01', 'failed dashboard requests leave an empty chart and table with no message.');
      await expect(adminDashboard.salesHeading).toBeVisible();

      await expect(adminDashboard.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });
});

test.describe('Admin access control', () => {
  test('a signed-in customer cannot open the back office', { tag: ['@mocked', '@negative'] }, async ({ signedIn: _, page }) => {
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });

    await expect(page).not.toHaveURL(/\/admin/);
  });
});

import { ADMIN_SECTIONS } from '@components/Header';
import { expect, mock, test, withMocks } from '@fixtures';
import { alertAppears } from '@pages/admin/alerts';
import { ORDER_STATUS, paginated } from '@support/admin-payloads';
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
    await expect(adminDashboard.latestOrders.row(backOffice.order.invoice_number)).toContainText(ORDER_STATUS);
  });

  // The baseline of ADM-01: a dashboard whose requests succeed announces nothing, so an alert on a failing one is news.
  test('a healthy dashboard shows no alert', async ({ adminDashboard, backOffice }) => {
    // Anchor on what the last answer draws (the orders table), then watch for an alert for a short window.
    await expect(adminDashboard.latestOrders.row(backOffice.order.invoice_number)).toBeVisible();
    await expect(adminDashboard.salesChart).toBeVisible();

    expect(await alertAppears(adminDashboard.alerts), 'no alert appears on a healthy dashboard').toBe(false);
  });

  test('an order on the dashboard opens for editing', async ({ adminDashboard, backOffice, page }) => {
    await adminDashboard.latestOrders.edit(backOffice.order.invoice_number);

    await expect(page).toHaveURL(`/admin/orders/edit/${backOffice.order.id}`);
  });

  test('the admin menu reaches every back-office section', async ({ adminDashboard, page }) => {
    for (const section of ADMIN_SECTIONS) {
      await adminDashboard.shell.header.openAdminSection(section);
      await expect(page, section).toHaveURL(`/admin/${section.toLowerCase()}`);
      await expect(adminDashboard.sectionHeading(section), section).toBeVisible();
    }
  });

  test.describe('with no orders waiting', () => {
    test.use(withMocks(mock.respond('GET', '/invoices', paginated([]))));

    test('the dashboard says there are no recent orders', async ({ adminDashboard }) => {
      await expect(adminDashboard.noOrders).toBeVisible();
      await expect(adminDashboard.latestOrders.rows).toHaveCount(0);
    });
  });

  test.describe('when the dashboard data fails to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/invoices', 500), mock.fail('GET', '/reports/total-sales-of-years', 500)));

    test('the admin is told the dashboard could not be loaded', async ({ adminDashboard }) => {
      knownBug('ADM-01', 'failed dashboard requests leave an empty chart and table with no message.');
      await expect(adminDashboard.salesHeading).toBeVisible();

      // Any alert will do: the pin does not prescribe the wording (a healthy dashboard shows none, see above).
      await expect(adminDashboard.alerts.first(), 'ADM-01: a failed dashboard tells the admin').toBeVisible({ timeout: 5_000 });
    });
  });
});

test.describe('Admin access control (mocked customer session)', { tag: ['@mocked'] }, () => {
  test('a signed-in customer cannot open the back office', { tag: ['@negative'] }, async ({ signedIn: _, page }) => {
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL('/auth/login');
  });
});

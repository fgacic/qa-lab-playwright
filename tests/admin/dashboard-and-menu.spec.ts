import { ADMIN_SECTIONS } from '@components/Header';
import { expect, mock, test, withMocks } from '@fixtures';
import { alertAppears, allowLoggedFailure } from '@pages/admin/alerts';
import { ORDER_STATUS, paginated } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** What only the back office reads: the dashboard's orders and sales report, the user list and the inbox. */
const ADMIN_ONLY_ENDPOINTS = /^\/(?:invoices|users|messages|reports\/[^/]+)$/;

/**
 * Back office with a mocked admin session and a mocked admin API (fixtures/admin.ts). These
 * specs prove how the UI behaves on given responses; they do not prove the real backend.
 * The real journeys are tests/admin-e2e, against the self-hosted Toolshop.
 */
test.describe('Admin dashboard and menu (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the dashboard shows the sales chart', async ({ adminDashboard }) => {
    await expect(adminDashboard.salesHeading).toBeVisible();
    await expect(adminDashboard.salesChart).toBeVisible();
  });

  test('the dashboard asks for the orders awaiting fulfilment and lists them', async ({ adminDashboard, backOffice, apiMock }) => {
    // The fixture opened the page already; open it again to catch the request for this check.
    const asked = apiMock.waitForRequest('GET', '/invoices');
    await adminDashboard.open();

    expect(new URL((await asked).url()).searchParams.get('in'), 'the request filters on the status').toBe(`status,${ORDER_STATUS}`);
    await expect(adminDashboard.latestOrders.row(backOffice.order.invoice_number)).toContainText(ORDER_STATUS);
  });

  // The baseline of ADM-01: a dashboard whose requests succeed announces nothing, so an alert on a failing one is news.
  test('a healthy dashboard shows no alert', async ({ adminDashboard, backOffice }) => {
    // Anchor on what the last answer draws (the orders table), then watch for an alert for a short window.
    await expect(adminDashboard.latestOrders.row(backOffice.order.invoice_number)).toBeVisible();
    await expect(adminDashboard.salesChart).toBeVisible();

    expect(await alertAppears(adminDashboard.failure), 'no failure message appears on a healthy dashboard').toBe(false);
  });

  test('an order on the dashboard opens for editing', async ({ adminDashboard, backOffice, page }) => {
    await adminDashboard.latestOrders.edit(backOffice.order.invoice_number);

    await expect(page).toHaveURL(`/admin/orders/edit/${backOffice.order.id}`);
  });

  // One test per section: a section that breaks fails alone, and the others still say whether they work.
  for (const [index, section] of ADMIN_SECTIONS.entries()) {
    // The page opens on the dashboard, so the menu is first used to move to the next section in the list (the last one wraps to the first):
    // every section, the dashboard included, is then reached from a page that is not its own.
    const startsFrom = ADMIN_SECTIONS[(index + 1) % ADMIN_SECTIONS.length];

    test(`the admin menu reaches ${section}`, async ({ adminDashboard, page }) => {
      await adminDashboard.shell.header.openAdminSection(startsFrom);
      await expect(page).toHaveURL(`/admin/${startsFrom.toLowerCase()}`);

      await adminDashboard.shell.header.openAdminSection(section);

      await expect(page).toHaveURL(`/admin/${section.toLowerCase()}`);
      await expect(adminDashboard.sectionHeading(section)).toBeVisible();
    });
  }

  test.describe('with no orders waiting', () => {
    test.use(withMocks(mock.respond('GET', '/invoices', paginated([]))));

    test('the dashboard says there are no recent orders', async ({ adminDashboard }) => {
      await expect(adminDashboard.noOrders).toBeVisible();
      await expect(adminDashboard.latestOrders.rows).toHaveCount(0);
    });
  });

  test.describe('when the dashboard data fails to load', { tag: ['@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/invoices', 500), mock.fail('GET', '/reports/total-sales-of-years', 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the admin is told the dashboard could not be loaded', async ({ adminDashboard }) => {
      knownBug('ADM-01', 'failed dashboard requests leave an empty chart and table with no message.', { absence: true });
      await expect(adminDashboard.salesHeading).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording (a healthy dashboard shows none, see above).
      await expect(adminDashboard.failure, 'ADM-01: a failed dashboard tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});

test.describe('Admin access control (mocked customer session)', { tag: ['@mocked'] }, () => {
  test('a signed-in customer cannot open the back office', { tag: ['@negative'] }, async ({ signedIn: _, adminEntrance, page, apiMock }) => {
    await adminEntrance.tryToOpen();

    await expect(page).toHaveURL('/auth/login');
    // Turned away before the dashboard asked for anything: no order list, report, user list or inbox was requested.
    await expect(apiMock.expectNoRequest('GET', ADMIN_ONLY_ENDPOINTS), 'no admin endpoint was called for a customer').resolves.toBeUndefined();
  });
});

import { ADMIN_SECTIONS } from '@components/Header';
import { expect, mock, test, withMocks } from '@fixtures';
import { ADMIN_SECTION_PATHS } from '@pages/admin/AdminPages';
import { allowLoggedFailure, appearsWithin } from '@pages/admin/alerts';
import { ORDER_STATUS, paginated, reports } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/**
 * Back office with a mocked admin session and a mocked admin API (fixtures/admin.ts). These
 * specs prove how the UI behaves on given responses; they do not prove the real backend.
 * The real journeys are tests/admin-e2e, against the self-hosted Toolshop.
 */
test.describe('Admin dashboard and menu (mocked back office)', { tag: ['@mocked'] }, () => {
  // A <canvas> has nothing to read, so the bars the app drew are measured (AdminDashboardPage.drawnBars): there is one per year
  // of the report and each is as tall as its total, whatever the app coloured it. A canvas that is merely visible proves nothing:
  // it is just as visible when the report failed (ADM-01).
  const SALES_REPORTS = {
    'two years': reports.totalSalesOfYears,
    'three years': [{ year: 2024, total: 1000 }, { year: 2025, total: 4000 }, { year: 2026, total: 2000 }],
  };
  for (const [name, report] of Object.entries(SALES_REPORTS)) {
    test.describe(`with a report of ${name}`, () => {
      test.use(withMocks(mock.respond('GET', '/reports/total-sales-of-years', report)));

      test('the sales chart draws one bar per year, as tall as its total', async ({ adminDashboard }) => {
        await expect(adminDashboard.salesHeading).toBeVisible();

        const bars = await adminDashboard.drawnBars();

        expect(bars, 'one bar per year of the report').toHaveLength(report.length);
        const tallest = Math.max(...bars);
        const highest = Math.max(...report.map(({ total }) => total));
        // The axis starts a little above zero, so the heights are proportional to the totals only approximately (to within 0.05 of the tallest bar).
        bars.forEach((height, index) => expect(height / tallest, `the bar of ${report[index].year} against the tallest`).toBeCloseTo(report[index].total / highest, 1));
      });
    });
  }

  test.describe('with a report that fails', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('GET', '/reports/total-sales-of-years', 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    // Not the pin (ADM-01 is below): it says what the chart does draw, so a failed report is told from a healthy one by more than "the canvas is there".
    test('the sales chart has no bars', async ({ adminDashboard }) => {
      await expect(adminDashboard.salesHeading).toBeVisible();

      expect(await adminDashboard.drawnBars(), 'a failed report draws axes and no bars').toEqual([]);
    });
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

    expect(await appearsWithin(adminDashboard.failure), 'no failure message appears on a healthy dashboard').toBe(false);
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
      await expect(page, `the menu moved to ${startsFrom}`).toHaveURL(ADMIN_SECTION_PATHS[startsFrom]);

      await adminDashboard.shell.header.openAdminSection(section);

      await expect(page, `the menu moved to ${section}`).toHaveURL(ADMIN_SECTION_PATHS[section]);
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

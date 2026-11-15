import { expect, mock, test, withMocks } from '@fixtures';
import { reportColumns, type ReportTitle } from '@pages/admin/AdminPages';
import { reports } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

const REPORT_TITLES: ReportTitle[] = ['Top 10 Best Selling Categories', 'Top 10 Most Purchased Products', 'Customers By Country', 'Total Sales Per Country'];

test.describe('Admin reports (mocked back office)', { tag: ['@mocked'] }, () => {
  test('statistics show the four reports', async ({ adminStatistics }) => {
    await expect(adminStatistics.heading).toBeVisible();
    await expect(adminStatistics.report('Top 10 Best Selling Categories')).toContainText(reports.bestSellingCategories[0].category_name);
    await expect(adminStatistics.report('Top 10 Most Purchased Products')).toContainText(reports.purchasedProducts[0].name);
    await expect(adminStatistics.report('Customers By Country')).toContainText(reports.customersByCountry[0].country);
    await expect(adminStatistics.report('Total Sales Per Country')).toContainText(`$${reports.salesPerCountry[0].total_sales}`);
  });

  test.describe('with no sales yet', () => {
    test.use(withMocks(
      mock.respond('GET', '/reports/top10-best-selling-categories', []),
      mock.respond('GET', '/reports/top10-purchased-products', []),
      mock.respond('GET', '/reports/customers-by-country', []),
      mock.respond('GET', '/reports/total-sales-per-country', []),
    ));

    // `adminStatistics` returns once all four reports have been answered (here: with nothing).
    test('the report tables are empty', async ({ adminStatistics }) => {
      await expect(adminStatistics.heading).toBeVisible();
      for (const title of REPORT_TITLES) {
        // The column titles are what an empty answer leaves on screen: a table that never rendered would also have no rows.
        await expect(adminStatistics.columns(title), title).toHaveText(reportColumns(title));
        await expect(adminStatistics.report(title), title).toHaveCount(0);
      }
    });
  });

  test.describe('when the reports fail to load', { tag: ['@bug'] }, () => {
    test.use(withMocks(...[
      '/reports/top10-best-selling-categories', '/reports/top10-purchased-products', '/reports/customers-by-country', '/reports/total-sales-per-country',
    ].map((feed) => mock.fail('GET', feed, 500))));

    test('the admin is told the statistics could not be loaded', async ({ adminStatistics }) => {
      knownBug('ADM-15', 'failed statistics requests leave empty tables with no message.');
      await expect(adminStatistics.heading).toBeVisible();

      // Any alert will do: the pin does not prescribe the wording. A healthy page shows none.
      await expect(adminStatistics.alerts.first(), 'ADM-15: failed statistics tell the admin').toBeVisible({ timeout: 5_000 });
    });
  });

  // A <canvas> has nothing to read, so what is proved is its presence, and that the picked year is asked for.
  for (const period of ['month', 'week'] as const) {
    test.describe(`average sales per ${period}`, () => {
      test.use({ adminSalesPeriod: period });

      test(`average sales per ${period} shows its chart area and reloads for another year`, async ({ adminSalesReport }) => {
        await expect(adminSalesReport.chart).toBeVisible();

        const reloaded = await adminSalesReport.showYear('2020');

        expect(new URL(reloaded.url()).searchParams.get('year')).toBe('2020');
        await expect(adminSalesReport.year).toHaveValue('2020');
      });
    });
  }

  test('the year picker offers the current year', { tag: ['@bug'] }, async ({ adminMonthlySales }) => {
    knownBug('ADM-08', 'the sales reports stop at 2025 and open on it; the current year cannot be chosen.');
    const thisYear = String(new Date().getFullYear());
    await expect(adminMonthlySales.year.getByRole('option').first()).toBeAttached();

    await expect(adminMonthlySales.year.getByRole('option', { name: thisYear }), `ADM-08: ${thisYear} can be chosen`).toHaveCount(1, { timeout: 2_000 });
  });
});

test.describe('Admin settings (mocked back office)', { tag: ['@mocked'] }, () => {
  test('saving stores the settings in the browser and confirms', async ({ adminSettings }) => {
    await expect(adminSettings.ecoBadge, 'the badge starts switched on').toBeChecked();
    await adminSettings.paymentEndpoint.fill('https://payments.example.com/check');
    await adminSettings.ecoBadge.uncheck();

    await adminSettings.save();

    await expect(adminSettings.feedback.filter({ hasText: 'Settings saved!' })).toBeVisible();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBe('https://payments.example.com/check');
    await expect.poll(() => adminSettings.storedSetting('ECO_BADGE_ENABLED')).toBe('false');
  });

  test('switching geolocation on is stored and still on after a reload', async ({ adminSettings }) => {
    await expect(adminSettings.retrieveGeolocation, 'geolocation starts switched off').not.toBeChecked();

    await adminSettings.retrieveGeolocation.check();
    await adminSettings.save();

    await expect(adminSettings.feedback.filter({ hasText: 'Settings saved!' })).toBeVisible();
    await expect.poll(() => adminSettings.storedSetting('RETRIEVE_GEOLOCATION')).toBe('true');
    await adminSettings.page.reload();
    await expect(adminSettings.retrieveGeolocation).toBeChecked();
  });

  test('a payment endpoint that is not a URL is refused', { tag: ['@negative', '@bug'] }, async ({ adminSettings }) => {
    knownBug('ADM-16', 'the settings accept any text as the payment endpoint and report "Settings saved!".');
    await adminSettings.paymentEndpoint.fill('not a url');

    await adminSettings.save();

    // Any alert that names the endpoint will do: the pin does not prescribe the wording.
    await expect(adminSettings.feedback.filter({ hasText: /endpoint|url|invalid/i }), 'ADM-16: the settings say the endpoint is not valid').toBeVisible({ timeout: 2_000 });
  });

  test('Clear storage forgets the settings but keeps the admin signed in', async ({ adminSettings }) => {
    await adminSettings.paymentEndpoint.fill('https://payments.example.com/check');
    await adminSettings.save();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT'), 'the setting was saved before it is cleared').toBe('https://payments.example.com/check');

    await adminSettings.clearStorage();

    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBeNull();
    await expect.poll(() => adminSettings.storedToken()).not.toBeNull();
  });

  test('switching the CO₂ features off hides the CO₂ sorting in the shop', async ({ adminSettings, shop }) => {
    const sort = shop.home.filters.sort;
    await expect(adminSettings.co2Features, 'the features start switched on').toBeChecked();
    await shop.home.open();
    await expect(sort.getByRole('option', { name: /CO₂/ }).first(), 'the shop offers CO₂ sorting while the features are on').toBeAttached();
    await adminSettings.open();

    await adminSettings.co2Features.uncheck();
    await adminSettings.save();
    await expect(adminSettings.feedback.filter({ hasText: 'Settings saved!' })).toBeVisible();
    await shop.home.open();

    await expect(sort.getByRole('option', { name: 'Name (A - Z)' })).toBeAttached();
    await expect(sort.getByRole('option', { name: /CO₂/ })).toHaveCount(0);
  });
});

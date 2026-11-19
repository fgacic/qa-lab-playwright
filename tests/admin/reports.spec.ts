import { expect, mock, test, withMocks } from '@fixtures';
import { REPORT_TITLES, reportColumns } from '@pages/admin/AdminReports';
import { appearsWithin, withLoggedFailure } from '@pages/admin/alerts';
import { reports } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** Each figure of an average-sales report is drawn as two bars side by side: the average and the amount of orders. */
const BARS_PER_FIGURE = 2;
/** How many bars the chart of each period must draw for the mocked report. */
const SALES_BARS = { month: reports.averageSalesPerMonth.length * BARS_PER_FIGURE, week: reports.averageSalesPerWeek.length * BARS_PER_FIGURE } as const;

test.describe('Admin reports (mocked back office)', { tag: ['@mocked'] }, () => {
  test('statistics show the four reports, each row with its figure', async ({ adminStatistics }) => {
    await expect(adminStatistics.heading).toBeVisible();
    // The whole row of each report, figure included: a swapped, dropped or reformatted column fails. Money is written with a
    // dollar sign and no decimals (the API sends the amount as a string, "1234"); counts are plain numbers.
    const { bestSellingCategories, purchasedProducts, customersByCountry, salesPerCountry } = reports;
    await expect(adminStatistics.cells('Top 10 Best Selling Categories')).toHaveText([bestSellingCategories[0].category_name, `$${bestSellingCategories[0].total_earned}`]);
    await expect(adminStatistics.cells('Top 10 Most Purchased Products')).toHaveText([purchasedProducts[0].name, String(purchasedProducts[0].count)]);
    await expect(adminStatistics.cells('Customers By Country')).toHaveText([customersByCountry[0].country, String(customersByCountry[0].amount)]);
    await expect(adminStatistics.cells('Total Sales Per Country')).toHaveText([salesPerCountry[0].billing_country, `$${salesPerCountry[0].total_sales}`]);
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

  test.describe('when the reports fail to load', { tag: ['@negative', '@bug'] }, () => {
    test.use(withLoggedFailure(...[
      '/reports/top10-best-selling-categories', '/reports/top10-purchased-products', '/reports/customers-by-country', '/reports/total-sales-per-country',
    ].map((feed) => mock.fail('GET', feed, 500))));

    test('the admin is told the statistics could not be loaded', async ({ adminStatistics }) => {
      knownBug('ADM-15', 'failed statistics requests leave empty tables with no message.', { absence: true });
      await expect(adminStatistics.heading).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording. A healthy page shows none.
      await expect(adminStatistics.failure, 'ADM-15: failed statistics tell the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  // A <canvas> has nothing to read, so the bars the app drew are measured (AdminSalesReportPage.drawnBars), one per entry of
  // the answer; what the page does with a year is proved on the request it sends.
  for (const period of ['month', 'week'] as const) {
    test.describe(`average sales per ${period}`, () => {
      test.use({ adminSalesPeriod: period });

      test(`the ${period} report draws its bars`, async ({ adminSalesReport }) => {
        await expect(adminSalesReport.heading).toBeVisible();

        expect(await adminSalesReport.drawnBars(), `two bars (average, orders) per ${period} of the report`).toHaveLength(SALES_BARS[period]);
      });

      test(`picking a year asks the API for that year's ${period} report`, async ({ adminSalesReport }) => {
        // Any year but the one the picker opens on, so the pick really changes something.
        await expect(adminSalesReport.yearOptions).not.toHaveCount(0);
        const year = await adminSalesReport.anotherYear();

        const reloaded = await adminSalesReport.showYear(year);

        expect(new URL(reloaded.url()).searchParams.get('year'), 'the year the page asked for').toBe(year);
        await expect(adminSalesReport.year).toHaveValue(year);
      });
    });

    // An empty answer is not a failure: the report is drawn (heading, year picker, chart area) and says nothing.
    test.describe(`average sales per ${period} with no figures yet`, () => {
      test.use({ adminSalesPeriod: period, ...withMocks(mock.respond('GET', `/reports/average-sales-per-${period}`, [])) });

      test(`an empty ${period} report keeps its chart area and raises no alert`, async ({ adminSalesReport }) => {
        await expect(adminSalesReport.heading).toBeVisible();
        expect(await adminSalesReport.drawnBars(), 'an empty report draws axes and no bars').toEqual([]);
        await expect(adminSalesReport.yearOptions).not.toHaveCount(0);

        expect(await appearsWithin(adminSalesReport.failure), `no failure message appears on an empty ${period} report`).toBe(false);
      });
    });
  }

  test('the year picker offers the current year', { tag: ['@negative', '@bug'] }, async ({ adminMonthlySales }) => {
    knownBug('ADM-08', 'the sales reports stop at 2025 and open on it; the current year cannot be chosen.');
    const thisYear = await adminMonthlySales.currentYear();
    await expect(adminMonthlySales.year.getByRole('option').first()).toBeAttached();

    await expect(adminMonthlySales.year.getByRole('option', { name: thisYear }), `ADM-08: ${thisYear} can be chosen`).toHaveCount(1, { timeout: BUG_TIMEOUT });
  });
});

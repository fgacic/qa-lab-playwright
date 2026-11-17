import { expect, mock, test, withMocks } from '@fixtures';
import { REPORT_TITLES, reportColumns } from '@pages/admin/AdminReports';
import { ADMIN_MESSAGES, appearsWithin, withLoggedFailure } from '@pages/admin/alerts';
import { category, paginated, product, reports } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { storedToken } from '@support/session';
import { httpsUrl } from '@support/urls';

/** Each figure of an average-sales report is drawn as two bars side by side: the average and the amount of orders. */
const BARS_PER_FIGURE = 2;
/** How many bars the chart of each period must draw for the mocked report. */
const SALES_BARS = { month: reports.averageSalesPerMonth.length * BARS_PER_FIGURE, week: reports.averageSalesPerWeek.length * BARS_PER_FIGURE } as const;
/** A payment endpoint the settings accept: made up, on example.com. */
const PAYMENT_ENDPOINT = httpsUrl('payments.example.com', '/check');

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

test.describe('Admin settings (mocked back office)', { tag: ['@mocked'] }, () => {
  test('saving stores the settings in the browser and confirms', async ({ adminSettings }) => {
    await expect(adminSettings.ecoBadge, 'the badge starts switched on').toBeChecked();
    await adminSettings.paymentEndpoint.fill(PAYMENT_ENDPOINT);
    await adminSettings.ecoBadge.uncheck();

    await adminSettings.save();

    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBe(PAYMENT_ENDPOINT);
    await expect.poll(() => adminSettings.storedSetting('ECO_BADGE_ENABLED')).toBe('false');
  });

  test('switching geolocation on is stored and still on after a reload', async ({ adminSettings }) => {
    await expect(adminSettings.retrieveGeolocation, 'geolocation starts switched off').not.toBeChecked();

    await adminSettings.retrieveGeolocation.check();
    await adminSettings.save();

    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await expect.poll(() => adminSettings.storedSetting('RETRIEVE_GEOLOCATION')).toBe('true');
    await adminSettings.page.reload();
    await expect(adminSettings.retrieveGeolocation).toBeChecked();
  });

  test('a payment endpoint that is not a URL is refused', { tag: ['@negative', '@bug'] }, async ({ adminSettings }) => {
    knownBug('ADM-16', 'the settings accept any text as the payment endpoint and report "Settings saved!".', { absence: true });
    await adminSettings.paymentEndpoint.fill('not a url');

    await adminSettings.save();

    // Any alert that names the endpoint will do: the pin does not prescribe the wording.
    await expect(adminSettings.feedback.filter({ hasText: /endpoint|url|invalid/i }), 'ADM-16: the settings say the endpoint is not valid').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  test('Clear storage forgets the settings but keeps the admin signed in', async ({ adminSettings }) => {
    await adminSettings.paymentEndpoint.fill(PAYMENT_ENDPOINT);
    await adminSettings.save();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT'), 'the setting was saved before it is cleared').toBe(PAYMENT_ENDPOINT);

    await adminSettings.clearStorage();

    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBeNull();
    await expect.poll(() => storedToken(adminSettings.page)).not.toBeNull();
  });

  test('settings reach the shop: switching the CO₂ features off hides the CO₂ sorting in the shop', async ({ adminSettings, shop, apiMock }) => {
    // The shop's home asks for its products, filters and spec names: all answered here, so nothing depends on the real catalogue.
    await apiMock.use(
      mock.respond('QUERY', '/products', paginated([product], 9)),
      mock.respond('GET', '/categories/tree', [category]),
      mock.respond('GET', '/product-specs/names', []),
    );
    const sort = shop.home.filters.sort;
    await expect(adminSettings.co2Features, 'the features start switched on').toBeChecked();
    await shop.home.open();
    await expect(sort.getByRole('option', { name: /CO₂/ }).first(), 'the shop offers CO₂ sorting while the features are on').toBeAttached();
    await adminSettings.open();

    await adminSettings.co2Features.uncheck();
    await adminSettings.save();
    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await shop.home.open();

    await expect(sort.getByRole('option', { name: 'Name (A - Z)' })).toBeAttached();
    await expect(sort.getByRole('option', { name: /CO₂/ })).toHaveCount(0);
  });

  test('settings reach the shop: switching the eco-friendly badge off removes it from an eco product in the shop', async ({ adminSettings, shop, apiMock }) => {
    const eco = { ...product, is_eco_friendly: true };
    await apiMock.use(mock.respond('GET', /^\/products\/[^/]+$/, eco), mock.respond('GET', /^\/products\/[^/]+\/related$/, []));
    const shopProduct = shop.product;
    await expect(adminSettings.ecoBadge, 'the badge starts switched on').toBeChecked();
    await shopProduct.open(eco.id);
    await expect(shopProduct.ecoBadge, 'the shop shows the badge while it is on').toHaveText('ECO');
    await adminSettings.open();

    await adminSettings.ecoBadge.uncheck();
    await adminSettings.save();
    await expect(adminSettings.feedback.filter({ hasText: ADMIN_MESSAGES.settingsSaved })).toBeVisible();
    await shopProduct.open(eco.id);

    await expect(shopProduct.name).toHaveText(eco.name);
    await expect(shopProduct.ecoBadge).toHaveCount(0);
  });
});

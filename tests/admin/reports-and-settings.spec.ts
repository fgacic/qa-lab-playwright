import { expect, mock, test, withMocks } from '@fixtures';
import { reports } from '@support/admin-payloads';
import { knownBug } from '@support/known-bug';

test.describe('Admin reports (mocked back office)', { tag: ['@mocked'] }, () => {
  test('statistics show the four reports', async ({ adminStatistics }) => {
    await expect(adminStatistics.heading).toBeVisible();
    await expect(adminStatistics.report('Top 10 Best Selling Categories')).toContainText(reports.bestSellingCategories[0].category_name);
    await expect(adminStatistics.report('Top 10 Most Purchased Products')).toContainText(reports.purchasedProducts[0].name);
    await expect(adminStatistics.report('Customers By Country')).toContainText('The Netherlands');
    await expect(adminStatistics.report('Total Sales Per Country')).toContainText('$4321');
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
      for (const title of ['Top 10 Best Selling Categories', 'Top 10 Most Purchased Products', 'Customers By Country', 'Total Sales Per Country'] as const) {
        await expect(adminStatistics.report(title), title).toHaveCount(0);
      }
    });
  });

  test('average sales per month draws a chart and reloads for another year', async ({ adminMonthlySales, apiMock }) => {
    await expect(adminMonthlySales.chart).toBeVisible();
    const reloaded = apiMock.waitForRequest('GET', '/reports/average-sales-per-month');

    await adminMonthlySales.showYear('2020');

    expect(new URL((await reloaded).url()).searchParams.get('year')).toBe('2020');
  });

  test('average sales per week draws a chart and reloads for another year', async ({ adminWeeklySales, apiMock }) => {
    await expect(adminWeeklySales.chart).toBeVisible();
    const reloaded = apiMock.waitForRequest('GET', '/reports/average-sales-per-week');

    await adminWeeklySales.showYear('2020');

    expect(new URL((await reloaded).url()).searchParams.get('year')).toBe('2020');
  });

  test('the year picker offers the current year', { tag: ['@bug'] }, async ({ adminMonthlySales }) => {
    knownBug('ADM-08', 'the sales reports stop at 2025 and open on it; the current year cannot be chosen.');
    const thisYear = String(new Date().getFullYear());
    await expect(adminMonthlySales.year.getByRole('option').first()).toBeAttached();

    await expect(adminMonthlySales.year.getByRole('option', { name: thisYear }), `ADM-08: ${thisYear} can be chosen`).toHaveCount(1, { timeout: 2_000 });
  });
});

test.describe('Admin settings (mocked back office)', { tag: ['@mocked'] }, () => {
  test('saving stores the settings in the browser and confirms', async ({ adminSettings }) => {
    await adminSettings.paymentEndpoint.fill('https://payments.example.com/check');
    await adminSettings.ecoBadge.uncheck();

    await adminSettings.save();

    await expect(adminSettings.feedback.filter({ hasText: 'Settings saved!' })).toBeVisible();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBe('https://payments.example.com/check');
    await expect.poll(() => adminSettings.storedSetting('ECO_BADGE_ENABLED')).toBe('false');
  });

  test('Clear storage forgets the settings but keeps the admin signed in', async ({ adminSettings, page }) => {
    await adminSettings.paymentEndpoint.fill('https://payments.example.com/check');
    await adminSettings.save();
    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT'), 'the setting was saved before it is cleared').toBe('https://payments.example.com/check');

    await adminSettings.clearStorage();

    await expect.poll(() => adminSettings.storedSetting('PAYMENT_ENDPOINT')).toBeNull();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('auth-token'))).not.toBeNull();
  });

  test.describe('when sustainability features are switched off', () => {
    test('the shop hides the CO₂ sorting', async ({ adminSettings, page }) => {
      await adminSettings.co2Features.uncheck();
      await adminSettings.save();

      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const sort = page.getByRole('combobox', { name: 'sort' });
      await expect(sort.getByRole('option', { name: 'Name (A - Z)' })).toBeAttached();
      await expect(sort.getByRole('option', { name: /CO₂/ })).toHaveCount(0);
    });
  });
});

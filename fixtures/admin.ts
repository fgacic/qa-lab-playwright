import { mergeTests, type Page } from '@playwright/test';
import { AdminBrandForm, AdminCategoryForm, AdminProductForm, AdminUserForm } from '@pages/admin/AdminForms';
import { AdminListPage } from '@pages/admin/AdminListPage';
import { ADMIN_LISTS, type AdminListName } from '@pages/admin/admin-lists';
import { AdminDashboardPage, AdminMessagePage, AdminOrderPage, AdminSalesReportPage, AdminSettingsPage, AdminStatisticsPage } from '@pages/admin/AdminPages';
import * as A from '@support/admin-payloads';
import { mock } from '@support/api-mock';
import { ADMIN_CREDENTIALS, apiPath } from '@support/env';
import { fakeJwt } from '@support/payloads';
import { installToken } from '@support/session';
import type { Product } from '@support/toolshop-api';
import { test as apiTest } from './api';
import { test as mocksTest } from './mocks';

/**
 * - `mocked`: a fake admin JWT and a mocked back office (below). Runs everywhere and never
 *   touches the real admin API: unmocked writes are refused and fail the test.
 * - `storage-state`: the real admin saved by tests/setup/admin.setup.ts (`admin` project).
 */
export type AdminSession = 'mocked' | 'storage-state';

/** The records the mocked back office serves, so specs can assert against them. */
export interface MockedBackOffice {
  product: Product;
  order: ReturnType<typeof A.order>;
}

/**
 * Products the page created through the real API, watched from the requests and responses
 * themselves (a timed-out wait in the test cannot leak one) and deleted when the test ends, pass or
 * fail. It is automatic in the `storage-state` session, so no real-backend test can forget to ask for
 * it, and does nothing in the mocked session (whose "created" product is a real catalogue record).
 * A product the UI deleted is dropped from the list as soon as its DELETE succeeds.
 */
export interface CreatedProducts {
  /** The ids created and not yet deleted. */
  pending(): string[];
}

export interface AdminFixtures {
  /** Signs the real admin in through the API (once per test, on first use) and returns a fresh token, for arranging and cleaning up. */
  adminToken: () => Promise<string>;
  createdProducts: CreatedProducts;
  adminSession: AdminSession;
  /** Which list `adminList` opens, for specs that run the same case over every list. */
  adminListName: AdminListName;
  adminList: AdminListPage<unknown>;
  backOffice: MockedBackOffice;
  adminDashboard: AdminDashboardPage;
  adminProducts: AdminListPage<AdminProductForm>;
  adminBrands: AdminListPage<AdminBrandForm>;
  adminCategories: AdminListPage<AdminCategoryForm>;
  adminOrders: AdminListPage<AdminOrderPage>;
  adminUsers: AdminListPage<AdminUserForm>;
  adminMessages: AdminListPage<AdminMessagePage>;
  adminStatistics: AdminStatisticsPage;
  /** Which report `adminSalesReport` opens, for specs that run the same case over both. */
  adminSalesPeriod: 'month' | 'week';
  adminSalesReport: AdminSalesReportPage;
  adminMonthlySales: AdminSalesReportPage;
  adminWeeklySales: AdminSalesReportPage;
  adminSettings: AdminSettingsPage;
}

/** Every admin endpoint the back office calls, answered with realistic records. */
function backOfficeMocks(product: Product, order: MockedBackOffice['order']) {
  const productPage = A.paginated([product], 9);
  const spec = { id: '01QALABSPEC00000000000000', product_id: product.id, spec_name: 'Weight', spec_value: '340', spec_unit: 'g' };
  return [
    mock.respond('GET', '/users/me', A.adminUser),
    mock.respond('GET', '/invoices', A.paginated([order])),
    mock.respond('QUERY', '/invoices/search', A.paginated([order])),
    mock.respond('GET', /^\/invoices\/[^/]+$/, order),
    mock.respond('PUT', /^\/invoices\/[^/]+\/status$/, A.updated),
    mock.respond('GET', '/users', A.paginated([A.customer])),
    mock.respond('QUERY', '/users/search', A.paginated([A.customer])),
    mock.respond('GET', /^\/users\/[^/]+$/, A.customer),
    mock.respond('POST', '/users/register', A.customer, 201),
    mock.respond('PUT', /^\/users\/[^/]+$/, A.updated),
    mock.respond('DELETE', /^\/users\/[^/]+$/, '', 204),
    mock.respond('GET', '/messages', A.paginated([A.contactMessage])),
    mock.respond('GET', /^\/messages\/[^/]+$/, A.contactMessage),
    mock.respond('PUT', /^\/messages\/[^/]+\/status$/, A.updated),
    mock.respond('POST', /^\/messages\/[^/]+\/reply$/, { id: '01QALABREPLY', message: 'ok' }, 201),
    mock.respond('GET', '/brands', [A.brand]),
    mock.respond('QUERY', '/brands/search', [A.brand]),
    mock.respond('GET', /^\/brands\/[^/]+$/, A.brand),
    mock.respond('POST', '/brands', A.brand, 201),
    mock.respond('PUT', /^\/brands\/[^/]+$/, A.updated),
    mock.respond('DELETE', /^\/brands\/[^/]+$/, '', 204),
    mock.respond('GET', '/categories', [A.category]),
    mock.respond('QUERY', '/categories/search', [A.category]),
    mock.respond('GET', /^\/categories\/tree\/[^/]+$/, A.category),
    mock.respond('POST', '/categories', A.category, 201),
    mock.respond('PUT', /^\/categories\/[^/]+$/, A.updated),
    mock.respond('DELETE', /^\/categories\/[^/]+$/, '', 204),
    mock.respond('QUERY', '/products', productPage),
    mock.respond('QUERY', '/products/search', productPage),
    mock.respond('GET', /^\/products\/[^/]+$/, product),
    mock.respond('GET', /^\/products\/[^/]+\/specs$/, [spec]),
    mock.respond('POST', '/products', product, 201),
    mock.respond('PUT', /^\/products\/[^/]+$/, A.updated),
    mock.respond('DELETE', /^\/products\/[^/]+$/, '', 204),
    mock.respond('POST', /^\/products\/[^/]+\/specs$/, { ...spec, id: '01QALABSPEC00000000000001' }, 201),
    mock.respond('DELETE', /^\/products\/[^/]+\/specs\/[^/]+$/, '', 204),
    mock.respond('GET', '/images', [product.product_image]),
    mock.respond('GET', '/reports/total-sales-of-years', A.reports.totalSalesOfYears),
    mock.respond('GET', '/reports/top10-best-selling-categories', A.reports.bestSellingCategories),
    mock.respond('GET', '/reports/top10-purchased-products', A.reports.purchasedProducts),
    mock.respond('GET', '/reports/customers-by-country', A.reports.customersByCountry),
    mock.respond('GET', '/reports/total-sales-per-country', A.reports.salesPerCountry),
    mock.respond('GET', '/reports/average-sales-per-month', A.reports.averageSalesPerMonth),
    mock.respond('GET', '/reports/average-sales-per-week', A.reports.averageSalesPerWeek),
  ];
}

export const test = mergeTests(apiTest, mocksTest).extend<AdminFixtures>({
  adminSession: ['mocked', { option: true }],
  // No runtime skip here: specs that need a real admin carry @admin, and the `admin` project that
  // runs them is only scheduled where a real admin may be used (playwright.config.ts).
  adminToken: async ({ api }, use) => {
    const { email, password } = ADMIN_CREDENTIALS;
    if (!email || !password) throw new Error('No admin credentials: set ADMIN_EMAIL and ADMIN_PASSWORD (the self-hosted shop is seeded with its own admin).');
    // Lazy, so mocked specs never sign in; one login per test.
    let token: Promise<string> | undefined;
    await use(() => (token ??= api.login(email, password)));
  },
  // Auto (like `xss`): an e2e test that created a product through the form and never asked for this fixture would leak it.
  createdProducts: [
    async ({ page, api, adminToken, adminSession }, use) => {
      if (adminSession !== 'storage-state') {
        await use({ pending: () => [] });
        return;
      }
      const pending = new Set<string>();
      const reads: Promise<void>[] = [];
      // Names of products whose create request went out and whose id is not (yet) known: no response, a response
      // that could not be read, or one still in flight. Their ids cannot be reached, so teardown looks them up by
      // name. The names are unique per test, which is why this is not a sweep by the "QaLab" prefix: another
      // worker's product, created at that moment, would match it too.
      const unaccounted = new Set<string>();
      page.on('request', (request) => {
        if (request.method() !== 'POST' || apiPath(request.url()) !== '/products') return;
        const name = (request.postDataJSON() as { name?: unknown } | null)?.name;
        if (typeof name === 'string') unaccounted.add(name);
      });
      page.on('response', (response) => {
        const request = response.request();
        const method = request.method();
        const pathname = apiPath(response.url());
        if (method === 'POST' && pathname === '/products') {
          const name = (request.postDataJSON() as { name?: string } | null)?.name;
          if (!response.ok()) {
            if (name) unaccounted.delete(name); // refused: nothing was created
            return;
          }
          // Read at once: the id is the only handle teardown has on the product.
          const read = response.json().then((body: { id?: string }) => {
            if (!body.id) throw new Error('A create response carried no product id, so the product could not be cleaned up.');
            pending.add(body.id);
            if (name) unaccounted.delete(name);
          });
          read.catch(() => undefined); // reported in teardown; this only keeps the rejection from going unhandled meanwhile
          reads.push(read);
        } else if (method === 'DELETE' && /^\/products\/[^/]+$/.test(pathname) && response.ok()) {
          pending.delete(pathname.split('/').pop()!);
        }
      });
      await use({ pending: () => [...pending] });

      // Clean up everything that can be reached, whatever else fails, then report every failure at once.
      const failures: unknown[] = (await Promise.allSettled(reads)).flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
      const outcomes = await Promise.allSettled([
        ...[...pending].map(async (id) => api.deleteProduct(await adminToken(), id)),
        ...[...unaccounted].map(async (name) => {
          const leaked = await api.findProductByName(await adminToken(), name);
          if (leaked) await api.deleteProduct(await adminToken(), leaked.id);
        }),
      ]);
      failures.push(...outcomes.flatMap((r) => (r.status === 'rejected' ? [r.reason] : [])));
      if (failures.length) throw new AggregateError(failures, `Cleaning up the products this test created failed ${failures.length} time(s)`);
    },
    { auto: true },
  ],
  adminListName: ['products', { option: true }],

  backOffice: async ({ page, adminSession, apiMock, adminToken, catalog }, use) => {
    if (adminSession === 'storage-state') {
      // The storageState from admin.setup.ts carries the session, but Toolshop's JWT lives 300 s
      // and cannot be refreshed (/users/refresh answers 500), so a fresh token is put in place.
      await installToken(page, await adminToken());
      const product = await catalog.inStock();
      await use({ product, order: A.order(product) });
      return;
    }
    const real = await catalog.inStock();
    // The served product carries the mocked brand and category, so the edit form can select them.
    const product = { ...real, brand: { id: A.brand.id, name: A.brand.name }, category: { ...real.category, id: A.category.id, name: A.category.name } } as Product;
    const order = A.order(product);
    await installToken(page, fakeJwt('admin'));
    // Defaults: a describe-level `withMocks()` or a test's `apiMock.use()` overrides any of them.
    await apiMock.useDefaults(...backOfficeMocks(product, order));
    await apiMock.blockUnmockedWrites();
    // Any write no mock answered is refused, and the `page` fixture fails the test that sent it.
    await use({ product, order });
  },

  adminDashboard: async ({ page, backOffice: _ }, use) => {
    const dashboard = new AdminDashboardPage(page);
    await dashboard.open();
    await use(dashboard);
  },
  adminList: async ({ page, adminListName, backOffice: _ }, use) => use(await openList<unknown>(page, ADMIN_LISTS[adminListName])),
  adminProducts: async ({ page, backOffice: _ }, use) => use(await openList(page, ADMIN_LISTS.products)),
  adminBrands: async ({ page, backOffice: _ }, use) => use(await openList(page, ADMIN_LISTS.brands)),
  adminCategories: async ({ page, backOffice: _ }, use) => use(await openList(page, ADMIN_LISTS.categories)),
  adminOrders: async ({ page, backOffice: _ }, use) => use(await openList(page, ADMIN_LISTS.orders)),
  adminUsers: async ({ page, backOffice: _ }, use) => use(await openList(page, ADMIN_LISTS.users)),
  adminMessages: async ({ page, backOffice: _ }, use) => use(await openList(page, ADMIN_LISTS.messages)),
  adminStatistics: async ({ page, backOffice: _ }, use) => {
    const statistics = new AdminStatisticsPage(page);
    await statistics.open();
    await use(statistics);
  },
  adminSalesPeriod: ['month', { option: true }],
  adminSalesReport: async ({ page, adminSalesPeriod, backOffice: _ }, use) => {
    const report = new AdminSalesReportPage(page, adminSalesPeriod);
    await report.open();
    await use(report);
  },
  adminMonthlySales: async ({ page, backOffice: _ }, use) => {
    const report = new AdminSalesReportPage(page, 'month');
    await report.open();
    await use(report);
  },
  adminWeeklySales: async ({ page, backOffice: _ }, use) => {
    const report = new AdminSalesReportPage(page, 'week');
    await report.open();
    await use(report);
  },
  adminSettings: async ({ page, backOffice: _ }, use) => {
    const settings = new AdminSettingsPage(page);
    await settings.open();
    await use(settings);
  },
});

async function openList<Detail>(page: Page, config: ConstructorParameters<typeof AdminListPage<Detail>>[1]): Promise<AdminListPage<Detail>> {
  const list = new AdminListPage(page, config);
  await list.open();
  return list;
}

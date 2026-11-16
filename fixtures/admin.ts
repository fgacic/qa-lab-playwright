import { mergeTests, type Page } from '@playwright/test';
import { AdminBrandForm, AdminCategoryForm, AdminProductForm, AdminUserForm } from '@pages/admin/AdminForms';
import { AdminListPage } from '@pages/admin/AdminListPage';
import { ADMIN_LISTS, type AdminListName } from '@pages/admin/admin-lists';
import { AdminDashboardPage, AdminMessagePage, AdminOrderPage, AdminSalesReportPage, AdminSettingsPage, AdminStatisticsPage } from '@pages/admin/AdminPages';
import * as A from '@support/admin-payloads';
import { mock } from '@support/api-mock';
import { fakeJwt } from '@support/payloads';
import { installToken } from '@support/session';
import type { Product } from '@support/toolshop-api';
import { test as adminTokenTest } from './admin-token';
import { test as cleanupTest } from './admin-cleanup';
import { test as mocksTest } from './mocks';

/** The records the mocked back office serves, so specs can assert against them. (The real one has none to hand out: reading them there throws.) */
export interface MockedBackOffice {
  readonly product: Product;
  readonly order: ReturnType<typeof A.order>;
}

const NO_REAL_RECORDS = 'backOffice.product and backOffice.order exist only in the mocked session: the real back office serves the real catalogue (read it through the `catalog` fixture).';

/** The page-object fixtures; the session option and the cleanup fixtures (`createdProducts`, `createdUsers`, `brandFactory`) come from admin-cleanup.ts. */
export interface AdminFixtures {
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
  /** The monthly report, whatever `adminSalesPeriod` says: for specs that are about that one report. */
  adminMonthlySales: AdminSalesReportPage;
  /** The dashboard page object, not opened and with no back office behind it: for a visitor who may be turned away before the dashboard asks for anything. */
  adminEntrance: AdminDashboardPage;
  adminSettings: AdminSettingsPage;
}

/** Every admin endpoint the back office calls, answered with realistic records. */
function backOfficeMocks(product: Product, order: MockedBackOffice['order']) {
  const productPage = A.paginated([product], 9);
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
    mock.respond('GET', /^\/products\/[^/]+\/specs$/, [A.spec]),
    mock.respond('POST', '/products', product, 201),
    mock.respond('PUT', /^\/products\/[^/]+$/, A.updated),
    mock.respond('DELETE', /^\/products\/[^/]+$/, '', 204),
    mock.respond('POST', /^\/products\/[^/]+\/specs$/, { ...A.spec, id: '01QALABSPEC00000000000001' }, 201),
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

/** The mocked back office and its pages; the cleanup of what a real-backend test creates is in fixtures/admin-cleanup.ts. */
export const test = mergeTests(adminTokenTest, mocksTest, cleanupTest).extend<AdminFixtures>({
  adminListName: ['products', { option: true }],

  backOffice: async ({ page, adminSession, apiMock, adminToken }, use) => {
    if (adminSession === 'storage-state') {
      // The storageState from admin.setup.ts carries the session, but Toolshop's JWT lives 300 s
      // and cannot be refreshed (/users/refresh answers 500), so a fresh token is put in place.
      await installToken(page, await adminToken());
      // No catalogue lookup for the tests that never ask: a test that reads a record learns why there is none.
      await use({
        get product(): Product { throw new Error(NO_REAL_RECORDS); },
        get order(): MockedBackOffice['order'] { throw new Error(NO_REAL_RECORDS); },
      });
      return;
    }
    // A fixed product, carrying the mocked brand and category the edit form can select: nothing here depends on the catalogue.
    const order = A.order(A.product);
    await installToken(page, fakeJwt('admin'));
    // Defaults: a describe-level `withMocks()` or a test's `apiMock.use()` overrides any of them.
    await apiMock.useDefaults(...backOfficeMocks(A.product, order));
    await apiMock.blockUnmockedWrites();
    // Any write no mock answered is refused, and the `page` fixture fails the test that sent it.
    await use({ product: A.product, order });
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
  adminSalesReport: async ({ page, adminSalesPeriod, backOffice: _ }, use) => use(await openSalesReport(page, adminSalesPeriod)),
  adminMonthlySales: async ({ page, backOffice: _ }, use) => use(await openSalesReport(page, 'month')),
  // Unlike the other admin pages it needs no back office: it is also for a visitor who is not an admin.
  adminEntrance: async ({ page }, use) => use(new AdminDashboardPage(page)),
  adminSettings: async ({ page, backOffice: _ }, use) => {
    const settings = new AdminSettingsPage(page);
    await settings.open();
    await use(settings);
  },
});

async function openSalesReport(page: Page, period: 'month' | 'week'): Promise<AdminSalesReportPage> {
  const report = new AdminSalesReportPage(page, period);
  await report.open();
  return report;
}

async function openList<Detail>(page: Page, config: ConstructorParameters<typeof AdminListPage<Detail>>[1]): Promise<AdminListPage<Detail>> {
  const list = new AdminListPage(page, config);
  await list.open();
  return list;
}

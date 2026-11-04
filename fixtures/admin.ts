import { expect, mergeTests, type Page } from '@playwright/test';
import { AdminBrandForm, AdminCategoryForm, AdminProductForm, AdminUserForm } from '@pages/admin/AdminForms';
import { AdminListPage } from '@pages/admin/AdminListPage';
import { AdminDashboardPage, AdminMessagePage, AdminOrderPage, AdminSalesReportPage, AdminSettingsPage, AdminStatisticsPage } from '@pages/admin/AdminPages';
import * as A from '@support/admin-payloads';
import { mock } from '@support/api-mock';
import { ADMIN_CREDENTIALS, ADMIN_SKIP_REASON, RUN_ADMIN_TESTS } from '@support/env';
import { fakeJwt } from '@support/payloads';
import { installToken } from '@support/session';
import type { Product } from '@support/toolshop-api';
import { test as apiTest } from './api';
import { test as mocksTest } from './mocks';

/**
 * - `mocked`: a fake admin JWT and a mocked back office (below). Runs everywhere and never
 *   touches the real admin API: unmocked writes are refused and fail the test.
 * - `storage-state`: the real admin saved by tests/setup/admin.setup.ts (gated, `admin` project).
 */
export type AdminSession = 'mocked' | 'storage-state';

/** The records the mocked back office serves, so specs can assert against them. */
export interface MockedBackOffice {
  product: Product;
  order: ReturnType<typeof A.order>;
}

export interface AdminFixtures {
  /** A real admin API token, for arranging and cleaning up in the gated live journeys. */
  adminToken: string;
  adminSession: AdminSession;
  /** Which list `adminList` opens, for specs that run the same case over every list. */
  adminListName: keyof typeof ADMIN_LISTS;
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
  adminMonthlySales: AdminSalesReportPage;
  adminWeeklySales: AdminSalesReportPage;
  adminSettings: AdminSettingsPage;
}

export const ADMIN_LISTS = {
  products: { path: '/admin/products', heading: 'Products', searchLabel: 'Search products', addLink: 'Add Product', detail: (p: Page) => new AdminProductForm(p) },
  brands: { path: '/admin/brands', heading: 'Brands', searchLabel: 'Search brands', addLink: 'Add Brand', detail: (p: Page) => new AdminBrandForm(p) },
  categories: { path: '/admin/categories', heading: 'Categories', searchLabel: 'Search categories', addLink: 'Add Category', detail: (p: Page) => new AdminCategoryForm(p) },
  orders: { path: '/admin/orders', heading: 'Order', searchLabel: 'Search orders', detail: (p: Page) => new AdminOrderPage(p) },
  users: { path: '/admin/users', heading: 'Users', searchLabel: 'Search users', addLink: 'Add User', detail: (p: Page) => new AdminUserForm(p) },
  messages: { path: '/admin/messages', heading: 'Messages', detail: (p: Page) => new AdminMessagePage(p) },
} as const;

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
  adminToken: async ({ api }, use, testInfo) => {
    testInfo.skip(!RUN_ADMIN_TESTS, ADMIN_SKIP_REASON);
    await use(await api.login(ADMIN_CREDENTIALS.email ?? '', ADMIN_CREDENTIALS.password ?? ''));
  },
  adminListName: ['products', { option: true }],

  backOffice: async ({ page, adminSession, apiMock, api, catalog }, use, testInfo) => {
    if (adminSession === 'storage-state') {
      testInfo.skip(!RUN_ADMIN_TESTS, ADMIN_SKIP_REASON);
      // The storageState from admin.setup.ts carries the session, but Toolshop's JWT lives 300 s
      // and cannot be refreshed (/users/refresh answers 500), so a fresh token is put in place.
      await installToken(page, await api.login(ADMIN_CREDENTIALS.email ?? '', ADMIN_CREDENTIALS.password ?? ''));
      await use({ product: await catalog.inStock(), order: A.order(await catalog.inStock()) });
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
    await use({ product, order });
    expect(apiMock.blockedWrites, 'writes that reached no mock (refused, never sent)').toEqual([]);
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

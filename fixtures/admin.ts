import { randomUUID } from 'node:crypto';
import { mergeTests, type Page, type Request } from '@playwright/test';
import { AdminBrandForm, AdminCategoryForm, AdminProductForm, AdminUserForm } from '@pages/admin/AdminForms';
import { AdminListPage } from '@pages/admin/AdminListPage';
import { ADMIN_LISTS, type AdminListName } from '@pages/admin/admin-lists';
import { AdminDashboardPage, AdminMessagePage, AdminOrderPage, AdminSalesReportPage, AdminSettingsPage, AdminStatisticsPage } from '@pages/admin/AdminPages';
import * as A from '@support/admin-payloads';
import { mock } from '@support/api-mock';
import { apiPath } from '@support/env';
import { fakeJwt } from '@support/payloads';
import { installToken } from '@support/session';
import type { Product, ToolshopApi } from '@support/toolshop-api';
import { test as adminTokenTest } from './admin-token';
import { test as mocksTest } from './mocks';

/**
 * - `mocked`: a fake admin JWT and a mocked back office (below). Runs everywhere and never
 *   touches the real admin API: unmocked writes are refused and fail the test.
 * - `storage-state`: the real admin saved by tests/setup/admin.setup.ts (`admin` project).
 */
export type AdminSession = 'mocked' | 'storage-state';

/** The records the mocked back office serves, so specs can assert against them. (The real one has none to hand out: reading them there throws.) */
export interface MockedBackOffice {
  readonly product: Product;
  readonly order: ReturnType<typeof A.order>;
}

const NO_REAL_RECORDS = 'backOffice.product and backOffice.order exist only in the mocked session: the real back office serves the real catalogue (read it through the `catalog` fixture).';

/**
 * Products the page created through the real API, watched from the requests and responses
 * themselves (a timed-out wait in the test cannot leak one) and deleted when the test ends, pass or
 * fail. A test that creates a product asks for it by name; it does nothing in the mocked session (whose
 * "created" product is a real catalogue record). It is not automatic: an auto fixture would add a listener and a
 * teardown to every test of the suite, for the few that create anything.
 * A product the UI deleted is dropped from the list as soon as its DELETE succeeds.
 */
export interface CreatedProducts {
  /** The ids created and not yet deleted. */
  pending(): string[];
}

/**
 * Users the back office's form is about to create on the real backend, removed when the test ends. The test names the email
 * before it acts (`track`); teardown looks the account up by that exact email, so a user whose create response was never read, or
 * one the API accepted although the form says otherwise (ADM-20 once fixed), is removed too and the shop's user list never grows.
 */
export interface CreatedUsers {
  track(email: string): void;
}

/** Brands arranged through the admin API for a real-backend test, and removed when it ends (by slug, so a copy the UI made goes too). */
export interface BrandFactory {
  create(): Promise<{ id: string; name: string; slug: string }>;
}

export interface AdminFixtures {
  createdProducts: CreatedProducts;
  createdUsers: CreatedUsers;
  brandFactory: BrandFactory;
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

/**
 * The cleanup fixtures (`createdProducts`, `createdUsers`, `brandFactory`) run their teardown after the test body, pass or fail.
 * A pin wrapped in `knownBug` is `test.fail`, which accepts ANY failure, a teardown one included: under `VERIFY_BUGS=1`
 * (scripts/verify-bugs.mjs) a pin whose cleanup failed is reported as failing "for another reason", not as reproducing its
 * defect, so a leak cannot hide behind an expected failure there.
 */
export const test = mergeTests(adminTokenTest, mocksTest).extend<AdminFixtures>({
  adminSession: ['mocked', { option: true }],
  createdProducts: async ({ page, api, adminToken, adminSession }, use) => {
    if (adminSession !== 'storage-state') {
      await use({ pending: () => [] });
      return;
    }
    const pending = new Set<string>();
    const reads: Promise<void>[] = [];
    // Names of products whose create request went out and whose id is not (yet) known: no response, a response
    // that could not be read, or one still in flight. Their ids cannot be reached, so teardown looks them up by
    // name, by walking the catalogue (the shop's search drops words under 3 letters, BUG-28, so it cannot find
    // "Set of ..."). The names are unique per test, which is why this is not a sweep by the "QaLab" prefix:
    // another worker's product, created at that moment, would match it too.
    const unaccounted = new Set<string>();
    // On the context, like the mock layer: a product created from a second tab is watched too.
    const context = page.context();
    context.on('request', (request) => {
      if (request.method() !== 'POST' || apiPath(request.url()) !== '/products') return;
      const name = postedName(request);
      if (name) unaccounted.add(name);
    });
    context.on('response', (response) => {
      const request = response.request();
      const method = request.method();
      const pathname = apiPath(response.url());
      if (method === 'POST' && pathname === '/products') {
        const name = postedName(request);
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
        const leaked = await findInCatalogue(api, name);
        if (leaked) await api.deleteProduct(await adminToken(), leaked.id);
      }),
    ]);
    failures.push(...outcomes.flatMap((r) => (r.status === 'rejected' ? [r.reason] : [])));
    if (failures.length) throw new AggregateError(failures, `Cleaning up the products this test created failed ${failures.length} time(s)`);
  },
  createdUsers: async ({ api, adminToken, adminSession }, use) => {
    const emails = new Set<string>();
    await use({ track: (email) => void emails.add(email) });
    if (adminSession !== 'storage-state') return; // the mocked back office creates nothing real
    // Every removal is attempted whatever the others do, and every failure is reported at once, like the product cleanup.
    const outcomes = await Promise.allSettled([...emails].map(async (email) => {
      const token = await adminToken();
      const user = await api.findUserByEmail(token, email);
      if (user) await api.deleteUser(token, user.id);
    }));
    const failures = outcomes.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    if (failures.length) throw new AggregateError(failures, 'Cleaning up the users this test created failed');
  },
  brandFactory: async ({ api, adminToken, adminSession }, use) => {
    const made = new Set<string>(); // slugs, so a brand the UI saved under the same slug is removed as well
    await use({
      async create() {
        // Like `createdProducts` and `createdUsers`, it never touches the real API in the mocked session: that session has its own mocked brand (`A.brand`).
        if (adminSession !== 'storage-state') throw new Error("brandFactory arranges real brands: it needs adminSession 'storage-state' (the mocked back office serves A.brand).");
        const suffix = randomUUID().slice(0, 8);
        const brand = { name: `QaLab Brand ${suffix}`, slug: `qalab-brand-${suffix}` };
        made.add(brand.slug);
        return api.createBrand(await adminToken(), brand);
      },
    });
    if (!made.size) return;
    // The sign-in is part of the cleanup: a login that fails is reported with the removals, not thrown past them.
    // Every removal is attempted whatever the others do, and every failure is reported at once, like the product cleanup.
    const [outcome] = await Promise.allSettled([(async () => removeBrands(api, made, await adminToken()))()]);
    const failures = outcome.status === 'rejected' ? [outcome.reason] : outcome.value;
    if (failures.length) throw new AggregateError(failures, 'Cleaning up the brands this test created failed');
  },
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

/** Removes the brands with these slugs (the shop's brand list has no search), attempting every one and returning every failure. */
async function removeBrands(api: ToolshopApi, slugs: ReadonlySet<string>, token: string): Promise<unknown[]> {
  const brands = await api.listBrands();
  const removals = await Promise.allSettled(brands.filter(({ slug }) => slugs.has(slug)).map(({ id }) => api.deleteBrand(token, id)));
  return removals.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
}

async function openList<Detail>(page: Page, config: ConstructorParameters<typeof AdminListPage<Detail>>[1]): Promise<AdminListPage<Detail>> {
  const list = new AdminListPage(page, config);
  await list.open();
  return list;
}

/** The name a create request carries. A body that is missing or not JSON yields no name instead of throwing inside a page listener. */
function postedName(request: Request): string | undefined {
  try {
    const name = (request.postDataJSON() as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The product with exactly this name, found by walking the catalogue page by page, in the default list and in the
 * rentals the default list leaves out. Slow, and only for a product whose id never reached the test; it proves the
 * product is not there when it returns nothing.
 */
async function findInCatalogue(api: ToolshopApi, name: string): Promise<Product | undefined> {
  for (const query of [{}, { is_rental: 'true' }]) {
    for (let page = 1; ; page++) {
      const result = await api.listProducts({ ...query, page: String(page) });
      const found = result.data.find((product) => product.name === name);
      if (found) return found;
      if (page >= result.last_page) break;
    }
  }
  return undefined;
}

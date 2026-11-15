import { expect, mock, test, withMocks } from '@fixtures';
import type { AdminListName } from '@pages/admin/admin-lists';
import * as A from '@support/admin-payloads';
import { paginated } from '@support/admin-payloads';
import type { MockRoute } from '@support/api-mock';
import { knownBug } from '@support/known-bug';

/** Every back-office list, against an empty answer and a failing one. */
const lists: { name: AdminListName; feed: [MockRoute['method'], string]; empty: unknown; column: string }[] = [
  { name: 'products', feed: ['QUERY', '/products'], empty: paginated([], 9), column: 'Price' },
  { name: 'brands', feed: ['GET', '/brands'], empty: [], column: 'Slug' },
  { name: 'categories', feed: ['GET', '/categories'], empty: [], column: 'Slug' },
  { name: 'orders', feed: ['GET', '/invoices'], empty: paginated([]), column: 'Total' },
  { name: 'users', feed: ['GET', '/users'], empty: paginated([]), column: 'Email' },
  { name: 'messages', feed: ['GET', '/messages'], empty: paginated([]), column: 'Subject' },
];

test.describe('Admin lists on empty and failing APIs (mocked back office)', { tag: ['@mocked'] }, () => {
  for (const { name, feed: [method, path], empty, column } of lists) {
    test.describe(`${name}, empty`, () => {
      test.use({ adminListName: name, ...withMocks(mock.respond(method, path, empty)) });

      // `adminList` opens the page and returns once the list request has been answered (the empty mock).
      // An empty list is a table with its column titles and no rows, and no alert: nothing is "empty" about an error.
      test(`an empty ${name} list shows the table without rows`, async ({ adminList: list }) => {
        await expect(list.heading).toBeVisible();
        await expect(list.table.columnHeader(column)).toBeVisible();
        await expect(list.table.rows).toHaveCount(0);
        await expect(list.feedback).toHaveCount(0);
      });
    });

    test.describe(`${name}, failing`, { tag: ['@bug'] }, () => {
      test.use({ adminListName: name, ...withMocks(mock.fail(method, path, 500)) });

      test(`a failed ${name} list tells the admin`, async ({ adminList: list }) => {
        knownBug('ADM-07', 'a failed back-office list shows an empty table and no message, in every section.');
        await expect(list.heading).toBeVisible();

        // Any alert will do: the pin does not prescribe the wording. A healthy list shows none.
        await expect(list.feedback.first(), 'ADM-07: a failed list tells the admin').toBeVisible({ timeout: 5_000 });
      });
    });
  }
});

/** The lists that page: a second page is asked for, and what it answers replaces the first. */
test.describe('Admin list paging (mocked back office)', { tag: ['@mocked'] }, () => {
  test.describe('products', () => {
    test.use({ apiMocks: async ({ catalog }, use) => {
      const product = await catalog.inStock();
      const first = { ...product, id: '01QALABPAGEONEPRODUCT00000', name: 'Qa Lab Page One Product' };
      const second = { ...product, id: '01QALABPAGETWOPRODUCT00000', name: 'Qa Lab Page Two Product' };
      await use({ routes: [{ method: 'QUERY', path: '/products', responses: [{ status: 200, json: paginated([first], 9, { lastPage: 2 }) }, { status: 200, json: paginated([second], 9, { page: 2, lastPage: 2 }) }] }] });
    } });

    test('the second page of products is requested and replaces the first', async ({ adminProducts, apiMock }) => {
      await expect(adminProducts.table.row('Qa Lab Page One Product')).toBeVisible();
      const asked = apiMock.waitForRequest('QUERY', '/products');

      await adminProducts.pagination.goTo(2);

      expect((await asked).postDataJSON()).toEqual({ page: '2' });
      await expect(adminProducts.table.row('Qa Lab Page Two Product')).toBeVisible();
      await expect(adminProducts.table.row('Qa Lab Page One Product')).toHaveCount(0);
    });
  });

  test.describe('orders', () => {
    test.use({ apiMocks: async ({ catalog }, use) => {
      const product = await catalog.inStock();
      const first = A.order(product);
      const second = { ...first, id: '01QALABORDERPAGETWO000000', invoice_number: 'INV-2026999997' };
      await use({ routes: [{ method: 'GET', path: '/invoices', responses: [{ status: 200, json: paginated([first], 15, { lastPage: 2 }) }, { status: 200, json: paginated([second], 15, { page: 2, lastPage: 2 }) }] }] });
    } });

    test('the second page of orders is requested and replaces the first', async ({ adminOrders, backOffice, apiMock }) => {
      await expect(adminOrders.table.row(backOffice.order.invoice_number)).toBeVisible();
      const asked = apiMock.waitForRequest('GET', '/invoices');

      await adminOrders.pagination.goTo(2);

      expect(new URL((await asked).url()).searchParams.get('page')).toBe('2');
      await expect(adminOrders.table.row('INV-2026999997')).toBeVisible();
      await expect(adminOrders.table.row(backOffice.order.invoice_number)).toHaveCount(0);
    });
  });
});

import { expect, mock, test, withMocks } from '@fixtures';
import type { AdminListName } from '@pages/admin/admin-lists';
import { contactMessage, customer, order, paginated, product } from '@support/admin-payloads';
import type { MockRoute } from '@support/api-mock';
import { alertAppears } from '@pages/admin/alerts';
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
        // The column titles are what an empty answer leaves on screen: the anchor that the table has been drawn.
        await expect(list.table.columnHeader(column)).toBeVisible();
        await expect(list.table.rows).toHaveCount(0);

        expect(await alertAppears(list.feedback), `no alert appears on an empty ${name} list`).toBe(false);
      });
    });

    test.describe(`${name}, failing`, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: name, ...withMocks(mock.fail(method, path, 500)) });

      test(`a failed ${name} list tells the admin`, async ({ adminList: list }) => {
        knownBug('ADM-07', 'a failed back-office list shows an empty table and no message, in every section.', { absence: true });
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
    const first = { ...product, id: '01QALABPAGEONEPRODUCT00000', name: 'Qa Lab Page One Product' };
    const second = { ...product, id: '01QALABPAGETWOPRODUCT00000', name: 'Qa Lab Page Two Product' };
    test.use(withMocks(mock.sequence('QUERY', '/products', { status: 200, json: paginated([first], 9, { lastPage: 2 }) }, { status: 200, json: paginated([second], 9, { page: 2, lastPage: 2 }) })));

    test('the second page of products is requested and replaces the first', async ({ adminProducts, apiMock }) => {
      await expect(adminProducts.table.row(first.name)).toBeVisible();
      const asked = apiMock.waitForRequest('QUERY', '/products');

      await adminProducts.pagination.goTo(2);

      expect((await asked).postDataJSON()).toEqual({ page: '2' });
      await expect(adminProducts.table.row(second.name)).toBeVisible();
      await expect(adminProducts.table.row(first.name)).toHaveCount(0);
    });
  });

  // Orders, users and messages ask GET /<feed>?page=2. Each sequence answers a page 1 of 2, then the second page;
  // every row is named by a text only its own record has.
  const paged: { name: AdminListName; feed: string; first: { row: string; record: unknown }; second: { row: string; record: unknown } }[] = [
    { name: 'orders', feed: '/invoices', first: { row: order(product).invoice_number, record: order(product) }, second: { row: 'INV-2026999997', record: { ...order(product), id: '01QALABORDERPAGETWO000000', invoice_number: 'INV-2026999997' } } },
    { name: 'users', feed: '/users', first: { row: customer.email, record: customer }, second: { row: 'second.page@example.com', record: { ...customer, id: '01QALABUSERPAGETWO0000000', email: 'second.page@example.com' } } },
    { name: 'messages', feed: '/messages', first: { row: contactMessage.subject, record: contactMessage }, second: { row: 'Qa Lab Second Page Subject', record: { ...contactMessage, id: '01QALABMESSAGEPAGETWO0000', subject: 'Qa Lab Second Page Subject' } } },
  ];

  for (const { name, feed, first, second } of paged) {
    test.describe(name, () => {
      test.use({
        adminListName: name,
        ...withMocks(mock.sequence('GET', feed, { status: 200, json: paginated([first.record], 15, { lastPage: 2 }) }, { status: 200, json: paginated([second.record], 15, { page: 2, lastPage: 2 }) })),
      });

      test(`the second page of ${name} is requested and replaces the first`, async ({ adminList: list, apiMock }) => {
        await expect(list.table.row(first.row)).toBeVisible();
        const asked = apiMock.waitForRequest('GET', feed);

        await list.pagination.goTo(2);

        expect(new URL((await asked).url()).searchParams.get('page')).toBe('2');
        await expect(list.table.row(second.row)).toBeVisible();
        await expect(list.table.row(first.row)).toHaveCount(0);
      });
    });
  }
});

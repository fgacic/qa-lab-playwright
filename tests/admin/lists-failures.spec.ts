import { expect, mock, test, withMocks } from '@fixtures';
import type { AdminListName } from '@pages/admin/admin-lists';
import { contactMessage, customer, order, paginated, product } from '@support/admin-payloads';
import type { MockRoute } from '@support/api-mock';
import { alertAppears, allowLoggedFailure } from '@pages/admin/alerts';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/**
 * Every back-office list, against an empty answer and a failing one. `search` is the endpoint of its search box
 * (the messages list has none); it answers like the list does, so `empty` serves both.
 */
const lists: { name: AdminListName; feed: [MockRoute['method'], string]; search?: [MockRoute['method'], string]; empty: unknown; column: string }[] = [
  { name: 'products', feed: ['QUERY', '/products'], search: ['QUERY', '/products/search'], empty: paginated([], 9), column: 'Price' },
  { name: 'brands', feed: ['GET', '/brands'], search: ['QUERY', '/brands/search'], empty: [], column: 'Slug' },
  { name: 'categories', feed: ['GET', '/categories'], search: ['QUERY', '/categories/search'], empty: [], column: 'Slug' },
  { name: 'orders', feed: ['GET', '/invoices'], search: ['QUERY', '/invoices/search'], empty: paginated([]), column: 'Total' },
  { name: 'users', feed: ['GET', '/users'], search: ['QUERY', '/users/search'], empty: paginated([]), column: 'Email' },
  { name: 'messages', feed: ['GET', '/messages'], empty: paginated([]), column: 'Subject' },
];

test.describe('Admin lists on empty and failing APIs (mocked back office)', { tag: ['@mocked'] }, () => {
  for (const { name, feed: [method, path], search, empty, column } of lists) {
    test.describe(`${name}, empty`, () => {
      test.use({ adminListName: name, ...withMocks(mock.respond(method, path, empty)) });

      // `adminList` opens the page and returns once the list request has been answered (the empty mock).
      // An empty list is a table with its column titles and no rows, and no alert: nothing is "empty" about an error.
      test(`an empty ${name} list shows the table without rows`, async ({ adminList: list }) => {
        await expect(list.heading).toBeVisible();
        // The column titles are what an empty answer leaves on screen: the anchor that the table has been drawn.
        await expect(list.table.columnHeader(column)).toBeVisible();
        await expect(list.table.rows).toHaveCount(0);

        expect(await alertAppears(list.failure), `no failure message appears on an empty ${name} list`).toBe(false);
      });
    });

    test.describe(`${name}, failing`, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: name, ...withMocks(mock.fail(method, path, 500)) });
      test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

      test(`a failed ${name} list tells the admin`, async ({ adminList: list }) => {
        knownBug('ADM-07', 'a failed back-office list shows an empty table and no message, in every section.', { absence: true });
        await expect(list.heading).toBeVisible();

        // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording. A healthy list shows none.
        await expect(list.failure, 'ADM-07: a failed list tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });

    if (!search) continue;
    const [searchMethod, searchPath] = search;

    // A search whose answer is empty is not a failure: the table is drawn without rows, with its column titles, and says nothing.
    test.describe(`${name}, search finds nothing`, () => {
      test.use({ adminListName: name, ...withMocks(mock.respond(searchMethod, searchPath, empty)) });

      test(`a ${name} search with no match empties the table and raises no alert`, async ({ adminList: list }) => {
        await expect(list.table.rows.first(), 'the full list is shown before the search').toBeVisible();

        await list.search.searchFor('no such record');

        await expect(list.table.rows).toHaveCount(0);
        await expect(list.table.columnHeader(column)).toBeVisible();
        expect(await alertAppears(list.failure), `no failure message appears when a ${name} search finds nothing`).toBe(false);
      });
    });

    test.describe(`${name}, search failing`, { tag: ['@negative', '@bug'] }, () => {
      test.use({ adminListName: name, ...withMocks(mock.fail(searchMethod, searchPath, 500)) });
      test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

      test(`a failed ${name} search tells the admin`, async ({ adminList: list, apiMock }) => {
        knownBug('ADM-18', 'a failed search in a back-office list (500) leaves the previous table on screen and says nothing, so the admin takes it for the result.', { absence: true });
        await expect(list.table.rows.first(), 'the full list is shown before the search').toBeVisible();
        const refused = apiMock.waitForResponse(searchMethod, searchPath);

        await list.search.searchFor('anything');
        await refused;

        await expect(list.failure, 'ADM-18: a failed list search tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
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

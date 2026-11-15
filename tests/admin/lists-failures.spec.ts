import { expect, mock, test, withMocks } from '@fixtures';
import type { AdminListName } from '@pages/admin/admin-lists';
import { paginated } from '@support/admin-payloads';
import type { MockRoute } from '@support/api-mock';
import { knownBug } from '@support/known-bug';

/** Every back-office list, against an empty answer and a failing one. */
const lists: { name: AdminListName; feed: [MockRoute['method'], string]; empty: unknown }[] = [
  { name: 'products', feed: ['QUERY', '/products'], empty: paginated([], 9) },
  { name: 'brands', feed: ['GET', '/brands'], empty: [] },
  { name: 'categories', feed: ['GET', '/categories'], empty: [] },
  { name: 'orders', feed: ['GET', '/invoices'], empty: paginated([]) },
  { name: 'users', feed: ['GET', '/users'], empty: paginated([]) },
  { name: 'messages', feed: ['GET', '/messages'], empty: paginated([]) },
];

test.describe('Admin lists on empty and failing APIs (mocked back office)', { tag: ['@mocked'] }, () => {
  for (const { name, feed: [method, path], empty } of lists) {
    test.describe(`${name}, empty`, () => {
      test.use({ adminListName: name, ...withMocks(mock.respond(method, path, empty)) });

      // `adminList` opens the page and returns once the list request has been answered (the empty mock).
      test(`an empty ${name} list shows the table without rows`, async ({ adminList: list }) => {
        await expect(list.heading).toBeVisible();
        await expect(list.table.rows).toHaveCount(0);
      });
    });

    test.describe(`${name}, failing`, { tag: ['@bug'] }, () => {
      test.use({ adminListName: name, ...withMocks(mock.fail(method, path, 500)) });

      test(`a failed ${name} list tells the admin`, async ({ adminList: list }) => {
        knownBug('ADM-07', 'a failed back-office list shows an empty table and no message, in every section.');
        await expect(list.heading).toBeVisible();

        await expect(list.shell.errorAlert, 'ADM-07: a failed list tells the admin').toBeVisible({ timeout: 5_000 });
      });
    });
  }
});

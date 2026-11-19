import { expect, mock, test, withMocks } from '@fixtures';
import { PAGED_LISTS, paginated, product } from '@support/admin-payloads';

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

  // Orders, users and messages ask GET /<feed>?page=2. Each sequence answers a page 1 of 2, then the second page.
  for (const name of Object.keys(PAGED_LISTS) as (keyof typeof PAGED_LISTS)[]) {
    const { feed, first, second } = PAGED_LISTS[name];
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

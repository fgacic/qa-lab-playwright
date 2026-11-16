import { expect, mock, test } from '@fixtures';
import { SEARCH_HIT, dollars, paginated } from '@support/admin-payloads';

test.describe('Admin products list (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows each product with its stock status and price', async ({ adminProducts, backOffice }) => {
    const row = adminProducts.table.row(backOffice.product.id);

    await expect(row).toContainText(backOffice.product.name);
    // The Stock column shows the product's in-stock flag ("true" / "false"), not a count.
    await expect(row.getByRole('cell', { name: String(backOffice.product.in_stock), exact: true })).toBeVisible();
    await expect(row).toContainText(dollars(backOffice.product.price));
  });

  test('searching sends the term and lists the matches', async ({ adminProducts, backOffice, apiMock }) => {
    const match = { ...backOffice.product, id: '01QALABSEARCHHIT0000000000', name: SEARCH_HIT };
    await apiMock.use(mock.respond('QUERY', '/products/search', paginated([match], 9)));
    const sent = apiMock.waitForRequest('QUERY', '/products/search');

    await adminProducts.search.searchFor('pliers');

    expect((await sent).postDataJSON()).toEqual({ q: 'pliers' });
    await expect(adminProducts.table.row(match.name)).toBeVisible();
    await expect(adminProducts.table.rows).toHaveCount(1);
  });

  test('Reset clears the search and lists the whole catalogue again', async ({ adminProducts, backOffice, apiMock }) => {
    await apiMock.use(mock.respond('QUERY', '/products/search', paginated([], 9)));
    await adminProducts.search.searchFor('no such product');
    await expect(adminProducts.table.rows).toHaveCount(0);

    await adminProducts.search.reset();

    await expect(adminProducts.search.query).toHaveValue('');
    await expect(adminProducts.table.row(backOffice.product.id)).toBeVisible();
  });
});

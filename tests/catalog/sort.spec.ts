import { SORT_OPTIONS, type SortOption } from '@components/FilterPanel';
import { expect, test } from '@fixtures';
import type { Product, ProductPage } from '@support/toolshop-api';

const CO2_ORDER = ['A', 'B', 'C', 'D', 'E'];
const sortKey: Record<string, (p: Product) => string | number> = {
  name: (p) => p.name,
  price: (p) => p.price,
  co2_rating: (p) => CO2_ORDER.indexOf(p.co2_rating),
};

test.describe('Sorting', () => {
  for (const [label, value] of Object.entries(SORT_OPTIONS) as [SortOption, string][]) {
    const [field, direction] = value.split(',');

    test(`"${label}" orders the grid by ${field.replace('_', ' ')}, ${direction}ending`, async ({ homePage, apiMock }) => {
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === value);

      await homePage.filters.sortBy(label);

      const { json: sorted } = await results;
      expect(sorted.data).not.toHaveLength(0);
      expect(sorted.data.map(sortKey[field])).toBeSorted({ descending: direction === 'desc' });
      await expect(homePage.grid.names).toHaveText(sorted.data.map((p) => p.name));
      if (field === 'price') await expect.poll(() => homePage.grid.priceValues()).toBeSorted({ descending: direction === 'desc' });
    });
  }

  test('page 2 continues the order of page 1', async ({ homePage, apiMock }) => {
    const first = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === 'price,asc');
    await homePage.filters.sortBy('Price (Low - High)');
    const pageOne = (await first).json;
    const second = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === 'price,asc' && body.page === '2');

    await homePage.pagination.goTo(2);

    const pageTwo = (await second).json;
    expect(pageTwo.current_page).toBe(2);
    expect([...pageOne.data, ...pageTwo.data].map(sortKey.price)).toBeSorted();
    await expect(homePage.grid.names).toHaveText(pageTwo.data.map((p) => p.name));
    await expect.poll(() => homePage.grid.priceValues()).toEqual(pageTwo.data.map((p) => p.price));
  });
});

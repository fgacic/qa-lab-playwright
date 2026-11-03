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
      expect(sorted.data.map(sortKey[field])).toBeSorted({ descending: direction === 'desc' });
      await expect(homePage.grid.names).toHaveText(sorted.data.map((p) => p.name));
      if (field === 'price') expect(await homePage.grid.priceValues()).toBeSorted({ descending: direction === 'desc' });
    });
  }
});

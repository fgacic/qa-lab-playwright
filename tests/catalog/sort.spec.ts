import { SORT, SORT_OPTIONS, type SortOption } from '@components/FilterPanel';
import { expect, test } from '@fixtures';
import { PLIERS } from '@support/catalog-terms';
import type { Product, ProductPage } from '@support/toolshop-api';

const CO2_ORDER = ['A', 'B', 'C', 'D', 'E'];
/** The fields the sort menu offers, i.e. the part of each SORT_OPTIONS value before the comma. */
type SortField = 'name' | 'price' | 'co2_rating';
type SortDirection = 'asc' | 'desc';
/**
 * One key per field: an option for a new field fails to compile until it has a key here.
 * Names go to `toBeSorted` as they are: it compares text with `localeCompare` (English, case-insensitive), not by code
 * point, because the shop sorts in the database's collation, which ignores case ("hand saw" comes before "Hammer").
 */
const sortKey: Record<SortField, (p: Product) => string | number> = {
  name: (p) => p.name,
  price: (p) => p.price,
  co2_rating: (p) => CO2_ORDER.indexOf(p.co2_rating),
};

/** A category with several products, to sort inside a filter. */
const FILTERED_CATEGORY = PLIERS.category;
/** The sort the paging and filter tests use: its menu label, and the value the shop sends for it. */
const PRICE_ASCENDING = SORT_OPTIONS[SORT.priceAscending];

test.describe('Sorting', () => {
  for (const [label, value] of Object.entries(SORT_OPTIONS) as [SortOption, string][]) {
    const [field, direction] = value.split(',') as [SortField, SortDirection];

    test(`"${label}" orders the grid by ${field.replace('_', ' ')}, ${direction}ending`, async ({ homePage, apiMock }) => {
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === value);

      await homePage.filters.sortBy(label);

      const { json: sorted } = await results;
      expect(sorted.data).not.toHaveLength(0);
      expect(sorted.data.map(sortKey[field])).toBeSorted({ descending: direction === 'desc' });
      await expect(homePage.grid.names).toHaveText(sorted.data.map((p) => p.name));
      // The prices on the cards are the ones the API sent, in the same order.
      await expect.poll(() => homePage.grid.priceValues()).toEqual(sorted.data.map((p) => p.price));
    });
  }

  test('page 2 continues the order of page 1', async ({ homePage, apiMock }) => {
    const first = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === PRICE_ASCENDING);
    await homePage.filters.sortBy(SORT.priceAscending);
    const pageOne = (await first).json;
    const second = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === PRICE_ASCENDING && body.page === '2');

    await homePage.pagination.goTo(2);

    const pageTwo = (await second).json;
    expect(pageTwo.current_page).toBe(2);
    expect([...pageOne.data, ...pageTwo.data].map(sortKey.price)).toBeSorted();
    await expect(homePage.grid.names).toHaveText(pageTwo.data.map((p) => p.name));
    await expect.poll(() => homePage.grid.priceValues()).toEqual(pageTwo.data.map((p) => p.price));
  });

  test('sorting a filtered list keeps the filter and orders what is left', async ({ homePage, apiMock }) => {
    await homePage.filters.filterByCategory(FILTERED_CATEGORY);
    const sorted = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === PRICE_ASCENDING && !!body.by_category);

    await homePage.filters.sortBy(SORT.priceAscending);

    const { json: found } = await sorted;
    expect(found.data.length, `the catalogue should hold at least two ${FILTERED_CATEGORY}`).toBeGreaterThan(1);
    expect(found.data.filter((p) => p.category.name !== FILTERED_CATEGORY).map((p) => p.name), 'products outside the ticked category').toEqual([]);
    expect(found.data.map(sortKey.price)).toBeSorted();
    await expect(homePage.filters.category(FILTERED_CATEGORY)).toBeChecked();
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });
});

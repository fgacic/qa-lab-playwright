import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

/**
 * Filtering happens on the server: every change re-sends QUERY /products with the filter in
 * the body. Each test checks both halves: the request carries the filter, the API's answer
 * honours it, and the grid shows exactly that answer.
 */
test.describe('Product filters', () => {
  test('a category shows only products of that category', { tag: ['@smoke'] }, async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !!body.by_category);

    await homePage.filters.filterByCategory('Pliers');

    const { body, json: found } = await results;
    expect(body.by_category.split(',')).toHaveLength(1);
    expect(found.data.map((p) => p.category.name)).toEqual(found.data.map(() => 'Pliers'));
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('ticking a parent category ticks all of its subcategories', async ({ homePage }) => {
    const { filters } = homePage;

    await filters.filterByCategory('Power Tools');

    for (const child of ['Grinder', 'Sander', 'Saw', 'Drill']) {
      await expect(filters.category(child)).toBeChecked();
    }
    await expect(filters.category('Hammer')).not.toBeChecked();
  });

  test('a brand shows only products of that brand', async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !!body.by_brand);

    await homePage.filters.filterByBrand('MightyCraft Hardware');

    const { json: found } = await results;
    expect(found.total).toBeGreaterThan(0);
    expect(new Set(found.data.map((p) => p.brand.name))).toEqual(new Set(['MightyCraft Hardware']));
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('"eco-friendly only" shows only eco-friendly products', async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.eco_friendly === 'true');

    await homePage.filters.showOnlyEcoFriendly();

    const { json: found } = await results;
    expect(found.total).toBeGreaterThan(0);
    expect(found.data.every((p) => p.is_eco_friendly)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('category and brand filters combine', async ({ homePage, apiMock }) => {
    await homePage.filters.filterByCategory('Hammer');
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !!body.by_category && !!body.by_brand);

    await homePage.filters.filterByBrand('ForgeFlex Tools');

    const { json: found } = await results;
    expect(found.data.every((p) => p.category.name === 'Hammer' && p.brand.name === 'ForgeFlex Tools')).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('unticking a filter restores the unfiltered list', async ({ homePage, apiMock }) => {
    await homePage.filters.filterByCategory('Pliers');
    const restored = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !body.by_category);

    await homePage.filters.category('Pliers').uncheck();

    const { json: all } = await restored;
    await expect(homePage.grid.names).toHaveText(all.data.map((p) => p.name));
  });

  test('the price slider hides products above the maximum', async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === 'price,1,20');

    await homePage.filters.setMaxPrice(20);

    const { json: found } = await results;
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    for (const price of await homePage.grid.priceValues()) expect(price).toBeLessThanOrEqual(20);
  });

  test('the price slider hides products below the minimum', async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === 'price,15,100');

    await homePage.filters.setMinPrice(15);

    const { json: found } = await results;
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    for (const price of await homePage.grid.priceValues()) expect(price).toBeGreaterThanOrEqual(15);
  });

  test.describe('when the product list comes back empty', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products', emptyProductPage())));

    test('the grid shows the empty state', async ({ homePage }) => {
      await expect(homePage.grid.emptyState).toBeVisible();
      await expect(homePage.grid.cards).toHaveCount(0);
    });
  });

  for (const failure of [mock.fail('QUERY', '/products', 500), mock.abort('QUERY', '/products')]) {
    const how = 'abort' in failure.responses[0] ? 'cannot be reached' : 'answers 500';
    test.describe(`when the product list API ${how}`, { tag: ['@mocked', '@bug'] }, () => {
      test.use(withMocks(failure));

      test('the shopper is told the products could not be loaded', async ({ homePage }) => {
        knownBug('BUG-04', 'a failed product list leaves the grid blank with no message.');
        await expect(homePage.filters.sort).toBeVisible();

        await expect(homePage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
      });
    });
  }

  test.describe('when categories and brands come back empty', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', '/categories/tree', []), mock.respond('GET', '/brands', [])));

    test('the filter groups render without options', async ({ homePage }) => {
      await expect(homePage.grid.cards.first()).toBeVisible();
      await expect(homePage.filters.categories.getByRole('checkbox')).toHaveCount(0);
      await expect(homePage.filters.brands.getByRole('checkbox')).toHaveCount(0);
      await expect(homePage.filters.ecoFriendly).toBeVisible();
    });
  });

  test.describe('when categories and brands fail to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/categories/tree'), mock.fail('GET', '/brands')));

    test('the shopper is told the filters could not be loaded', async ({ homePage }) => {
      knownBug('BUG-05', 'failed category and brand requests leave empty filter groups with no message.');
      await expect(homePage.grid.cards.first()).toBeVisible();

      await expect(homePage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });
});

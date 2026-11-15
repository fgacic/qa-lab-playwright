import type { Page } from '@playwright/test';
import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

/**
 * Every one-dollar step of the price slider sends its own QUERY /products, and the shop shows
 * whichever answer arrives last (BUG-30). The slider tests below are about the filter, not that
 * race, so they let the answers through in the order they were asked for: each one waits until
 * the previous has been delivered. The race itself is pinned on its own, with a forced delay.
 */
async function answerProductQueriesInOrder(page: Page): Promise<void> {
  let previous: Promise<unknown> = Promise.resolve();
  await page.route(/\/products$/, async (route) => {
    if (route.request().method() !== 'QUERY') return route.fallback();
    const response = route.fetch();
    const turn = previous.then(() => response).then((fetched) => route.fulfill({ response: fetched }));
    previous = turn.catch(() => undefined);
    await turn;
  });
}

/** The upper price limit the slider test sets. */
const MAX_PRICE = 80;

/** How long the answer for an earlier price step is held back in the BUG-30 test. */
const LATE_ANSWER_MS = 2_000;
/** Time the grid gets, once every answer is in, to show the last one: the late answer plus a margin. */
const LATE_ANSWER_SETTLE_MS = LATE_ANSWER_MS + 1_000;

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
    expect(String(body.by_category).split(',')).toHaveLength(1);
    expect(found.total, 'the catalogue should contain pliers').toBeGreaterThan(0);
    expect(found.data.map((p) => p.category.name)).toEqual(found.data.map(() => 'Pliers'));
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('ticking a parent category ticks all of its subcategories and queries them all', async ({ homePage, apiMock }) => {
    const { filters } = homePage;
    const results = apiMock.waitForResponse('QUERY', '/products', (body) => !!body.by_category);

    await filters.filterByCategory('Power Tools');

    for (const child of ['Grinder', 'Sander', 'Saw', 'Drill']) {
      await expect(filters.category(child)).toBeChecked();
    }
    await expect(filters.category('Hammer')).not.toBeChecked();
    // The request must carry every ticked box (the parent and its four children), not only the one clicked.
    const ticked = await Promise.all((await filters.categories.getByRole('checkbox', { checked: true }).all()).map((box) => box.inputValue()));
    const { body } = await results;
    expect(ticked).toHaveLength(5);
    expect(String(body.by_category).split(',').sort()).toEqual(ticked.sort());
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

  test('the price slider hides products above the maximum', async ({ homePage, apiMock, page }) => {
    await answerProductQueriesInOrder(page);
    // The handle starts at $100 and moves one dollar per key press, each press its own request, so a
    // far target costs a long run of requests (80 for $20). $80 keeps it to 20 and still leaves the
    // dearest products (up to about $90) above the limit.
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,1,${MAX_PRICE}`);

    await homePage.filters.setMaxPrice(MAX_PRICE);

    const { json: found } = await results;
    expect(found.total, `the catalogue should contain products up to $${MAX_PRICE}`).toBeGreaterThan(0);
    expect(found.data.every((p) => p.price <= MAX_PRICE)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect.poll(() => homePage.grid.priceValues()).toEqual(found.data.map((p) => p.price));
  });

  test('the price slider hides products below the minimum', async ({ homePage, apiMock, page }) => {
    await answerProductQueriesInOrder(page);
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === 'price,15,100');

    await homePage.filters.setMinPrice(15);

    const { json: found } = await results;
    expect(found.total, 'the catalogue should contain products from $15').toBeGreaterThan(0);
    expect(found.data.every((p) => p.price >= 15)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect.poll(() => homePage.grid.priceValues()).toEqual(found.data.map((p) => p.price));
  });

  test('the grid shows the last price step, even when an earlier answer arrives late', { tag: ['@bug'] }, async ({ homePage, apiMock, page }) => {
    knownBug('BUG-30', 'each slider step sends its own request and the grid shows whichever answer arrives last, so a slow answer for an earlier step replaces the final filter.');
    // The answer for $14 is held back until after the one for $15, as a slow network can do.
    await page.route(/\/products$/, async (route) => {
      if (route.request().method() === 'QUERY' && route.request().postDataJSON()?.between === 'price,14,100') {
        await new Promise((resolve) => setTimeout(resolve, LATE_ANSWER_MS));
      }
      await route.fallback();
    });
    const late = apiMock.waitForResponse('QUERY', '/products', (body) => body.between === 'price,14,100');
    const final = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === 'price,15,100');

    await homePage.filters.setMinPrice(15);

    const { json: wanted } = await final;
    await late;
    await expect(homePage.grid.names, 'BUG-30: the grid shows the answer for the last step ($15 and up)').toHaveText(wanted.data.map((p) => p.name), { timeout: LATE_ANSWER_SETTLE_MS });
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

        await expect(homePage.shell.errorAlert, 'BUG-04: a failed product list is reported').toBeVisible({ timeout: 5_000 });
      });
    });
  }

  test.describe('when categories and brands come back empty', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', '/categories/tree', []), mock.respond('GET', '/brands', [])));

    test('the filter groups render without options', async ({ homePage, apiMock }) => {
      // Reload with the answers awaited: an empty group only means something once the data has arrived.
      await Promise.all([
        apiMock.waitForResponse('GET', '/categories/tree'),
        apiMock.waitForResponse('GET', '/brands'),
        homePage.page.reload({ waitUntil: 'domcontentloaded' }),
      ]);
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

      await expect(homePage.shell.errorAlert, 'BUG-05: failed category and brand requests are reported').toBeVisible({ timeout: 5_000 });
    });
  });
});

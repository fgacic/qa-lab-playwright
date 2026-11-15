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

/** The upper and lower price limits the slider tests set. */
const MAX_PRICE = 80;
const MIN_PRICE = 15;

/**
 * What the seeded catalogue offers, by name (the filter menu is read by label). The tests assert
 * against the API's answer for these, so only their existence is assumed here.
 */
const SEED = {
  category: 'Pliers',
  parentCategory: 'Power Tools',
  /** The subcategories of `parentCategory`, which ticking the parent ticks too. */
  children: ['Grinder', 'Sander', 'Saw', 'Drill'],
  /** A category that is not under `parentCategory`. */
  otherCategory: 'Hammer',
  brand: 'MightyCraft Hardware',
  /** A brand that sells in `otherCategory`. */
  hammerBrand: 'ForgeFlex Tools',
} as const;

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

    await homePage.filters.filterByCategory(SEED.category);

    const { body, json: found } = await results;
    expect(String(body.by_category).split(',')).toHaveLength(1);
    expect(found.total, 'the catalogue should contain pliers').toBeGreaterThan(0);
    expect(found.data.map((p) => p.category.name)).toEqual(found.data.map(() => SEED.category));
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('ticking a parent category ticks all of its subcategories and queries them all', async ({ homePage, apiMock }) => {
    const { filters } = homePage;
    const results = apiMock.waitForResponse('QUERY', '/products', (body) => !!body.by_category);

    await filters.filterByCategory(SEED.parentCategory);

    for (const child of SEED.children) {
      await expect(filters.category(child)).toBeChecked();
    }
    await expect(filters.category(SEED.otherCategory)).not.toBeChecked();
    // The request must carry every ticked box (the parent and its children), not only the one clicked.
    const tickedBoxes = filters.categories.getByRole('checkbox', { checked: true });
    await expect(tickedBoxes).toHaveCount(SEED.children.length + 1);
    const ticked = await Promise.all((await tickedBoxes.all()).map((box) => box.inputValue()));
    const { body } = await results;
    expect(String(body.by_category).split(',').sort()).toEqual(ticked.sort());
  });

  test('a brand shows only products of that brand', async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !!body.by_brand);

    await homePage.filters.filterByBrand(SEED.brand);

    const { json: found } = await results;
    expect(found.total).toBeGreaterThan(0);
    expect(new Set(found.data.map((p) => p.brand.name))).toEqual(new Set([SEED.brand]));
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
    await homePage.filters.filterByCategory(SEED.otherCategory);
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !!body.by_category && !!body.by_brand);

    await homePage.filters.filterByBrand(SEED.hammerBrand);

    const { json: found } = await results;
    expect(found.data.every((p) => p.category.name === SEED.otherCategory && p.brand.name === SEED.hammerBrand)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('unticking a filter restores the unfiltered list', async ({ homePage, apiMock }) => {
    await homePage.filters.filterByCategory(SEED.category);
    const restored = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !body.by_category);

    await homePage.filters.category(SEED.category).uncheck();

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
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE},100`);

    await homePage.filters.setMinPrice(MIN_PRICE);

    const { json: found } = await results;
    expect(found.total, `the catalogue should contain products from $${MIN_PRICE}`).toBeGreaterThan(0);
    expect(found.data.every((p) => p.price >= MIN_PRICE)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect.poll(() => homePage.grid.priceValues()).toEqual(found.data.map((p) => p.price));
  });

  test('moving both slider handles asks for the range between them', async ({ homePage, apiMock, page }) => {
    await answerProductQueriesInOrder(page);
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE},${MAX_PRICE}`);

    await homePage.filters.setMinPrice(MIN_PRICE);
    await homePage.filters.setMaxPrice(MAX_PRICE);

    const { json: found } = await results;
    expect(found.total, `the catalogue should contain products from $${MIN_PRICE} to $${MAX_PRICE}`).toBeGreaterThan(0);
    expect(found.data.every((p) => p.price >= MIN_PRICE && p.price <= MAX_PRICE)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect(homePage.filters.minPrice).toHaveAttribute('aria-valuenow', String(MIN_PRICE));
    await expect(homePage.filters.maxPrice).toHaveAttribute('aria-valuenow', String(MAX_PRICE));
  });

  test('the grid shows the last price step, even when an earlier answer arrives late', { tag: ['@bug'] }, async ({ homePage, apiMock, page }) => {
    knownBug('BUG-30', 'each slider step sends its own request and the grid shows whichever answer arrives last, so a slow answer for an earlier step replaces the final filter.');
    // The answer for the step below the last is held back until after the last one's, as a slow network can do.
    await page.route(/\/products$/, async (route) => {
      if (route.request().method() === 'QUERY' && route.request().postDataJSON()?.between === `price,${MIN_PRICE - 1},100`) {
        await new Promise((resolve) => setTimeout(resolve, LATE_ANSWER_MS));
      }
      await route.fallback();
    });
    const late = apiMock.waitForResponse('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE - 1},100`);
    const final = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE},100`);

    await homePage.filters.setMinPrice(MIN_PRICE);

    const { json: wanted } = await final;
    await late;
    await expect(homePage.grid.names, `BUG-30: the grid shows the answer for the last step ($${MIN_PRICE} and up)`).toHaveText(wanted.data.map((p) => p.name), { timeout: LATE_ANSWER_SETTLE_MS });
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

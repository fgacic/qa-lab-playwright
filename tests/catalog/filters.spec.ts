import { expect, mock, test, withMocks } from '@fixtures';
import { allowLoggedFailure } from '@pages/admin/alerts';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import { settleRequests } from '@support/settle';
import type { ProductPage } from '@support/toolshop-api';

/**
 * Every one-dollar step of the price slider sends its own QUERY /products, and the shop shows
 * whichever answer arrives last (BUG-30). The slider tests are about the filter, not that race,
 * so they call `apiMock.serialize('QUERY', '/products')`: the answers reach the page in the order
 * they were asked for. The race itself is pinned on its own, with `apiMock.delay`.
 */
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
  /** The shop's two brands, and a category of a different parent than `otherCategory`. */
  brands: ['ForgeFlex Tools', 'MightyCraft Hardware'],
  powerCategory: 'Drill',
} as const;
/** The slider test lowers the max to `CROSSED_MAX`, then presses the min up to `CROSSED_MIN`, past it. */
const CROSSED_MAX = 85;
const CROSSED_MIN = 90;

/** How long the answer for an earlier price step is held back in the BUG-30 test. */
const LATE_ANSWER_MS = 2_000;

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
    expect(found.total, `the catalogue should contain ${SEED.hammerBrand} products in ${SEED.otherCategory}`).toBeGreaterThan(0);
    expect(found.data.every((p) => p.category.name === SEED.otherCategory && p.brand.name === SEED.hammerBrand)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('two brands together show the products of either', async ({ homePage, apiMock }) => {
    const [first, second] = SEED.brands;
    await homePage.filters.filterByBrand(first);
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => String(body.by_brand).split(',').length === 2);

    await homePage.filters.filterByBrand(second);

    const { json: found } = await results;
    expect(found.total, 'the catalogue should contain products of both brands').toBeGreaterThan(0);
    expect(new Set(found.data.map((p) => p.brand.name)), 'the answer holds the products of both brands').toEqual(new Set(SEED.brands));
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('categories of different parents combine: the products of either', async ({ homePage, apiMock }) => {
    await homePage.filters.filterByCategory(SEED.otherCategory);
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => String(body.by_category).split(',').length === 2);

    await homePage.filters.filterByCategory(SEED.powerCategory);

    const { json: found } = await results;
    expect(new Set(found.data.map((p) => p.category.name)), `the answer holds ${SEED.otherCategory} and ${SEED.powerCategory} products`).toEqual(new Set([SEED.otherCategory, SEED.powerCategory]));
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('unticking a filter restores the unfiltered list', async ({ homePage, apiMock }) => {
    const narrowed = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !!body.by_category);
    await homePage.filters.filterByCategory(SEED.category);
    const { json: filtered } = await narrowed;
    const restored = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => !body.by_category);

    await homePage.filters.category(SEED.category).uncheck();

    const { json: all } = await restored;
    expect(all.total, 'the unfiltered list is longer than the one for the category').toBeGreaterThan(filtered.total);
    await expect(homePage.grid.names).toHaveText(all.data.map((p) => p.name));
  });

  test('the price slider hides products above the maximum', async ({ homePage, apiMock, api }) => {
    await apiMock.serialize('QUERY', '/products');
    const { total: unfiltered } = await api.listProducts();
    // The handle starts at $100 and moves one dollar per key press, each press its own request, so a
    // far target costs a long run of requests (80 for $20). $80 keeps it to 20 and still leaves the
    // dearest products (up to about $90) above the limit.
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,1,${MAX_PRICE}`);

    await homePage.filters.setMaxPrice(MAX_PRICE);

    const { json: found } = await results;
    expect(found.total, `the catalogue should contain products up to $${MAX_PRICE}`).toBeGreaterThan(0);
    expect(found.total, 'the limit hides the dearer products').toBeLessThan(unfiltered);
    expect(found.data.every((p) => p.price <= MAX_PRICE)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect.poll(() => homePage.grid.priceValues()).toEqual(found.data.map((p) => p.price));
  });

  test('the price slider hides products below the minimum', async ({ homePage, apiMock, api }) => {
    await apiMock.serialize('QUERY', '/products');
    const { total: unfiltered } = await api.listProducts();
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE},100`);

    await homePage.filters.setMinPrice(MIN_PRICE);

    const { json: found } = await results;
    expect(found.total, `the catalogue should contain products from $${MIN_PRICE}`).toBeGreaterThan(0);
    expect(found.total, 'the limit hides the cheaper products').toBeLessThan(unfiltered);
    expect(found.data.every((p) => p.price >= MIN_PRICE)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect.poll(() => homePage.grid.priceValues()).toEqual(found.data.map((p) => p.price));
  });

  test('moving both slider handles asks for the range between them', async ({ homePage, apiMock, api }) => {
    await apiMock.serialize('QUERY', '/products');
    const { total: unfiltered } = await api.listProducts();
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE},${MAX_PRICE}`);

    await homePage.filters.setMinPrice(MIN_PRICE);
    await homePage.filters.setMaxPrice(MAX_PRICE);

    const { json: found } = await results;
    expect(found.total, `the catalogue should contain products from $${MIN_PRICE} to $${MAX_PRICE}`).toBeGreaterThan(0);
    expect(found.total, 'the range hides products on both sides').toBeLessThan(unfiltered);
    expect(found.data.every((p) => p.price >= MIN_PRICE && p.price <= MAX_PRICE)).toBe(true);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect(homePage.filters.minPrice).toHaveAttribute('aria-valuenow', String(MIN_PRICE));
    await expect(homePage.filters.maxPrice).toHaveAttribute('aria-valuenow', String(MAX_PRICE));
  });

  test('the minimum handle never ends above the maximum one', { tag: ['@negative'] }, async ({ homePage, apiMock }) => {
    await apiMock.serialize('QUERY', '/products');
    const { filters } = homePage;
    await filters.setMaxPrice(CROSSED_MAX);

    // The key presses go past the max handle: the slider either stops the min there or carries the max along.
    await settleRequests(homePage.page, '/products', () => filters.setMinPrice(CROSSED_MIN));

    const [min, max] = await Promise.all([filters.minPrice, filters.maxPrice].map(async (handle) => Number(await handle.getAttribute('aria-valuenow'))));
    expect(min, 'the min handle is never above the max handle').toBeLessThanOrEqual(max);
    await expect.poll(async () => (await homePage.grid.priceValues()).filter((price) => price < min || price > max), 'prices on the grid outside the range').toEqual([]);
  });

  test('the grid shows the last price step, even when an earlier answer arrives late', { tag: ['@bug'] }, async ({ homePage, apiMock }) => {
    knownBug('BUG-30', 'each slider step sends its own request and the grid shows whichever answer arrives last, so a slow answer for an earlier step replaces the final filter.');
    await expect(homePage.grid.cards.first(), 'the grid shows products before the slider moves').toBeVisible();
    // The answer for the step below the last is held back until after the last one's, as a slow network can do.
    await apiMock.delay('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE - 1},100`, LATE_ANSWER_MS);
    const late = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE - 1},100`);
    const final = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.between === `price,${MIN_PRICE},100`);

    // Every product request must have finished and gone quiet (the held-back one included) before the grid is judged:
    // only then has the page drawn the late answer, so the pin cannot pass by looking before it replaces the grid.
    await settleRequests(homePage.page, '/products', () => homePage.filters.setMinPrice(MIN_PRICE));

    const { json: wanted } = await final;
    const { json: held } = await late;
    // The race only exists if the held answer is a different list from the last step's: otherwise a grid that showed it would look right.
    expect(held.data.map((p) => p.name), 'the held answer lists other products than the last step').not.toEqual(wanted.data.map((p) => p.name));
    await expect(homePage.grid.names, `BUG-30: the grid shows the answer for the last step ($${MIN_PRICE} and up)`).toHaveText(wanted.data.map((p) => p.name), { timeout: BUG_TIMEOUT });
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
      test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

      test('the shopper is told the products could not be loaded', async ({ homePage }) => {
        knownBug('BUG-04', 'a failed product list leaves the grid blank with no message.', { absence: true });
        await expect(homePage.filters.sort).toBeVisible();

        await expect(failureFeedback(homePage.page).first(), 'BUG-04: a failed product list is reported').toBeVisible({ timeout: BUG_TIMEOUT });
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
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the shopper is told the filters could not be loaded', async ({ homePage }) => {
      knownBug('BUG-05', 'failed category and brand requests leave empty filter groups with no message.', { absence: true });
      await expect(homePage.grid.cards.first()).toBeVisible();

      await expect(failureFeedback(homePage.page).first(), 'BUG-05: failed category and brand requests are reported').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});

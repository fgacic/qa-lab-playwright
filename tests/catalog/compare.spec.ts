import { expect, mock, test, withMocks } from '@fixtures';
import type { HomePage } from '@pages/HomePage';
import { AVAILABILITY, COMPARE_STORAGE_KEY, COMPARISON_ROW, priceText } from '@pages/ComparisonPage';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

test.describe('Product comparison', () => {
  /** Puts the first two products of the grid in the comparison and returns their names. */
  const pickTwo = async ({ grid }: HomePage): Promise<[string, string]> => {
    const [first, second] = await grid.productNames();
    await grid.compare(first);
    await grid.compare(second);
    return [first, second];
  };

  test('picking products shows the comparison bar with the count', { tag: ['@smoke'] }, async ({ homePage }) => {
    const [first] = await pickTwo(homePage);

    await expect(homePage.compareBar.selection).toHaveText(homePage.compareBar.selectedText(2));
    await expect(homePage.grid.card(first).compareButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('Compare Now opens a side-by-side table of the picked products', async ({ homePage, page }) => {
    const [first, second] = await pickTwo(homePage);
    // The link only carries the selection the app has stored: check that before leaving the page.
    await expect(homePage.grid.card(first).compareButton).toHaveAttribute('aria-pressed', 'true');
    await expect(homePage.grid.card(second).compareButton).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => homePage.comparison.selectedIds(), `${COMPARE_STORAGE_KEY} in the session`).toHaveLength(2);

    const comparison = await homePage.openComparison();

    await expect(page).toHaveURL('/comparison');
    await expect(comparison.productColumns).toContainText([first, second]);
  });

  test('pressing Compare again takes a product back out', async ({ homePage }) => {
    await homePage.grid.waitForLoaded();
    const first = homePage.grid.first();
    await first.compareButton.click();
    await expect(homePage.compareBar.selection).toHaveText(homePage.compareBar.selectedText(1));

    await first.compareButton.click();

    await expect(first.compareButton).toHaveAttribute('aria-pressed', 'false');
    await expect(homePage.compareBar.root).toBeHidden();
  });

  test('at most four products can be compared', { tag: ['@negative'] }, async ({ homePage }) => {
    await homePage.grid.waitForLoaded();
    for (let i = 0; i < 5; i++) await homePage.grid.nth(i).compareButton.click();

    // The shop says nothing about the refused fifth click (no toast, no message): the only sign is that it stays out.
    await expect(homePage.compareBar.selection).toHaveText(homePage.compareBar.selectedText(4));
    await expect(homePage.grid.nth(4).compareButton).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => homePage.comparison.selectedIds(), 'the refused product is not stored either').toHaveLength(4);
  });

  test('the selection survives opening a product and coming back', async ({ homePage }) => {
    const [first, second] = await pickTwo(homePage);
    await expect(homePage.compareBar.selection).toHaveText(homePage.compareBar.selectedText(2));

    const productPage = await homePage.openProduct(first);
    await productPage.backToShop();

    await expect(homePage.compareBar.selection).toHaveText(homePage.compareBar.selectedText(2));
    await expect(homePage.grid.card(first).compareButton).toHaveAttribute('aria-pressed', 'true');
    await expect(homePage.grid.card(second).compareButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('Clear All in the bar empties the selection', async ({ homePage }) => {
    await homePage.grid.waitForLoaded();
    await homePage.grid.first().compareButton.click();

    await homePage.compareBar.clearAll();

    await expect(homePage.compareBar.root).toBeHidden();
    await expect(homePage.grid.first().compareButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('the product page adds the product to the comparison', async ({ productPage, product }) => {
    await productPage.compare();

    // The product page gives no feedback of its own (no bar, no toast), so check where it went: the
    // selection the app has stored, before the next page load reads it.
    await expect.poll(() => productPage.comparison.selectedIds(), `${COMPARE_STORAGE_KEY} in the session`).toEqual([product.id]);
    const comparison = await productPage.openComparison();
    await expect(comparison.productColumns).toContainText([product.name]);
  });

  test.describe('on the comparison page', () => {
    test.use({
      comparedProducts: async ({ catalog }, use) => use([await catalog.inStock(), await catalog.outOfStock()]),
    });

    test('each row shows the products\' facts side by side', async ({ comparisonPage, comparedProducts }) => {
      const [inStock, outOfStock] = comparedProducts;

      await expect(comparisonPage.productColumns).toHaveCount(2);
      await expect(comparisonPage.cells(COMPARISON_ROW.price)).toHaveText([priceText(inStock.price), priceText(outOfStock.price)]);
      await expect(comparisonPage.cells(COMPARISON_ROW.brand)).toHaveText([inStock.brand.name, outOfStock.brand.name]);
      await expect(comparisonPage.cells(COMPARISON_ROW.category)).toHaveText([inStock.category.name, outOfStock.category.name]);
      await expect(comparisonPage.cells(COMPARISON_ROW.availability)).toHaveText([AVAILABILITY.inStock, AVAILABILITY.outOfStock]);
      await expect(comparisonPage.cells(COMPARISON_ROW.co2)).toHaveText([inStock.co2_rating, outOfStock.co2_rating]);
    });

    test('removing a product drops its column', async ({ comparisonPage, comparedProducts }) => {
      await comparisonPage.remove(comparedProducts[0].name);

      await expect(comparisonPage.productColumns).toHaveCount(1);
      await expect(comparisonPage.productColumns).toContainText(comparedProducts[1].name);
    });

    test('Clear All leaves the empty state with a way back to the shop', async ({ comparisonPage, page }) => {
      await comparisonPage.clearAll();

      await expect(comparisonPage.emptyState).toBeVisible();
      await comparisonPage.browseProductsLink.click();
      await expect(page).toHaveURL('/');
    });
  });

  test.describe('with a rental and a product', () => {
    test.use({
      comparedProducts: async ({ catalog }, use) => use([await catalog.rental(), await catalog.inStock()]),
    });

    test('the rental has a column of its own, with its price, brand and category', async ({ comparisonPage, comparedProducts }) => {
      const [rental, product] = comparedProducts;

      await expect(comparisonPage.productColumns).toContainText([rental.name, product.name]);
      await expect(comparisonPage.cells(COMPARISON_ROW.price)).toHaveText([priceText(rental.price), priceText(product.price)]);
      await expect(comparisonPage.cells(COMPARISON_ROW.brand)).toHaveText([rental.brand.name, product.brand.name]);
      await expect(comparisonPage.cells(COMPARISON_ROW.category)).toHaveText([rental.category.name, product.category.name]);
    });

    test('a rental is not called out of stock, as the rentals page and its own page do not', { tag: ['@bug'] }, async ({ comparisonPage }) => {
      knownBug('BUG-60', 'the comparison lists a rental as "Out of Stock" (the API marks the seeded rentals in_stock: false), while the rentals page and the rental\'s own page offer it for hire with an enabled Add to cart.');
      await expect(comparisonPage.cells(COMPARISON_ROW.availability), 'one cell for the rental and one for the product').toHaveCount(2);
      await expect(comparisonPage.cells(COMPARISON_ROW.availability).nth(1), 'the product in stock is listed as such').toHaveText(AVAILABILITY.inStock);

      await expect(comparisonPage.cells(COMPARISON_ROW.availability).first(), 'BUG-60: a rental is not listed as out of stock').not.toHaveText(AVAILABILITY.outOfStock, { timeout: BUG_TIMEOUT });
    });
  });

  test.describe('with two products of the same brand', () => {
    test.use({
      comparedProducts: async ({ api, catalog }, use) => {
        const first = await catalog.inStock();
        // Same brand, different price: the Brand row agrees and the Price row differs.
        const sameBrand = await api.findProduct('same-brand, different-price', (p) => p.brand.id === first.brand.id && p.id !== first.id && !p.is_rental && p.price !== first.price);
        await use([first, sameBrand]);
      },
    });

    test('"Show differences only" hides the rows where they agree', { tag: ['@bug'] }, async ({ comparisonPage, comparedProducts }) => {
      knownBug('BUG-12', '"Show differences only" hides nothing; rows where both products agree stay visible.');
      await expect(comparisonPage.cells(COMPARISON_ROW.brand)).toHaveText(comparedProducts.map((p) => p.brand.name));
      await expect(comparisonPage.row(COMPARISON_ROW.brand)).toBeVisible();
      await expect(comparisonPage.cells(COMPARISON_ROW.price)).toHaveText(comparedProducts.map((p) => priceText(p.price)));

      await comparisonPage.showDifferencesOnly.check();

      await expect(comparisonPage.row(COMPARISON_ROW.brand), 'BUG-12: "Show differences only" hides the rows where both products agree').toBeHidden({ timeout: BUG_TIMEOUT });
      // And the filter must not overreach: a row where they differ stays.
      await expect(comparisonPage.row(COMPARISON_ROW.price), 'BUG-12: "Show differences only" keeps the rows where the products differ').toBeVisible();
    });
  });

  test.describe('with nothing selected', () => {
    test('the comparison page shows the empty state', { tag: ['@negative'] }, async ({ comparisonPage }) => {
      await expect(comparisonPage.title).toBeVisible();
      await expect(comparisonPage.emptyState).toBeVisible();
      await expect(comparisonPage.table).toBeHidden();
    });
  });

  test.describe('when the comparison data comes back empty', { tag: ['@mocked'] }, () => {
    test.use({
      comparedProducts: async ({ catalog }, use) => use([await catalog.inStock()]),
      ...withMocks(mock.respond('POST', '/graphql', { data: {} })),
    });

    test('the empty state is shown', async ({ comparisonPage, apiMock }) => {
      // Let the first load finish: a reload that cuts a lazy chunk off mid-import makes WebKit and Firefox log an error of their own.
      await expect(comparisonPage.title).toBeVisible();
      // Reload with the mocked answer awaited: an empty state only means something once the data has arrived.
      await Promise.all([apiMock.waitForResponse('POST', '/graphql'), comparisonPage.page.reload({ waitUntil: 'domcontentloaded' })]);

      await expect(comparisonPage.emptyState).toBeVisible();
    });
  });

  test.describe('when the comparison data fails to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use({
      comparedProducts: async ({ catalog }, use) => use([await catalog.inStock()]),
      ...withMocks(mock.fail('POST', '/graphql', 500)),
    });

    test('the shopper is told the comparison could not be loaded', async ({ comparisonPage }) => {
      knownBug('BUG-09', 'a failed comparison request says "No products selected", although one is.', { absence: true });
      await expect(comparisonPage.title).toBeVisible();

      await expect(failureFeedback(comparisonPage.page).first(), 'BUG-09: a failed comparison request is reported').toBeVisible({ timeout: BUG_TIMEOUT });
      await expect(comparisonPage.emptyState, 'BUG-09: a failed comparison is not shown as an empty one').toBeHidden();
    });
  });
});

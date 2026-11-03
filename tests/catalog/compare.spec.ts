import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';

test.describe('Product comparison', () => {
  test('picking products shows the comparison bar with the count', { tag: ['@smoke'] }, async ({ homePage }) => {
    const [first, second] = await homePage.grid.productNames();

    await homePage.grid.compare(first);
    await homePage.grid.compare(second);

    await expect(homePage.compareBar.selection).toHaveText('2 product(s) selected');
    await expect(homePage.grid.card(first).compareButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('Compare Now opens a side-by-side table of the picked products', async ({ homePage, page }) => {
    const [first, second] = await homePage.grid.productNames();
    await homePage.grid.compare(first);
    await homePage.grid.compare(second);

    const comparison = await homePage.openComparison();

    await expect(page).toHaveURL('/comparison');
    await expect(comparison.productColumns).toHaveText([
      new RegExp(first),
      new RegExp(second),
    ]);
  });

  test('pressing Compare again takes a product back out', async ({ homePage }) => {
    await homePage.grid.productNames();
    const first = homePage.grid.first();
    await first.compareButton.click();
    await expect(homePage.compareBar.selection).toHaveText('1 product(s) selected');

    await first.compareButton.click();

    await expect(first.compareButton).toHaveAttribute('aria-pressed', 'false');
    await expect(homePage.compareBar.root).toBeHidden();
  });

  test('at most four products can be compared', { tag: ['@negative'] }, async ({ homePage }) => {
    await homePage.grid.productNames();
    for (let i = 0; i < 5; i++) await homePage.grid.nth(i).compareButton.click();

    await expect(homePage.compareBar.selection).toHaveText('4 product(s) selected');
    await expect(homePage.grid.nth(4).compareButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('Clear All in the bar empties the selection', async ({ homePage }) => {
    await homePage.grid.productNames();
    await homePage.grid.first().compareButton.click();

    await homePage.compareBar.clearAll();

    await expect(homePage.compareBar.root).toBeHidden();
    await expect(homePage.grid.first().compareButton).toHaveAttribute('aria-pressed', 'false');
  });

  test('the product page adds the product to the comparison', async ({ productPage, product }) => {
    await productPage.compare();

    // The product page gives no feedback of its own (no bar, no toast), so check where it went.
    const comparison = await productPage.openComparison();
    await expect(comparison.productColumns).toHaveText([new RegExp(product.name)]);
  });

  test.describe('on the comparison page', () => {
    test.use({
      comparedProducts: async ({ catalog }, use) => use([await catalog.inStock(), await catalog.outOfStock()]),
    });

    test('each row shows the products\' facts side by side', async ({ comparisonPage, comparedProducts }) => {
      const [inStock, outOfStock] = comparedProducts;

      await expect(comparisonPage.productColumns).toHaveCount(2);
      await expect(comparisonPage.cells('Price')).toHaveText([`$${inStock.price.toFixed(2)}`, `$${outOfStock.price.toFixed(2)}`]);
      await expect(comparisonPage.cells('Brand')).toHaveText([inStock.brand.name, outOfStock.brand.name]);
      await expect(comparisonPage.cells('Category')).toHaveText([inStock.category.name, outOfStock.category.name]);
      await expect(comparisonPage.cells('Availability')).toHaveText(['In Stock', 'Out of Stock']);
      await expect(comparisonPage.cells('CO₂ Rating')).toHaveText([inStock.co2_rating, outOfStock.co2_rating]);
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

  test.describe('with two products of the same brand', () => {
    test.use({
      comparedProducts: async ({ api, catalog }, use) => {
        const first = await catalog.inStock();
        const sameBrand = await api.findProduct('same-brand', (p) => p.brand.id === first.brand.id && p.id !== first.id && !p.is_rental);
        await use([first, sameBrand]);
      },
    });

    test('"Show differences only" hides the rows where they agree', { tag: ['@bug'] }, async ({ comparisonPage, comparedProducts }) => {
      knownBug('BUG-12', '"Show differences only" hides nothing; rows where both products agree stay visible.');
      await expect(comparisonPage.cells('Brand')).toHaveText(comparedProducts.map((p) => p.brand.name));
      await expect(comparisonPage.row('Brand')).toBeVisible();

      await comparisonPage.showDifferencesOnly.check();

      await expect(comparisonPage.row('Brand')).toBeHidden({ timeout: 5_000 });
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

    test('the empty state is shown', async ({ comparisonPage }) => {
      await expect(comparisonPage.emptyState).toBeVisible();
    });
  });

  test.describe('when the comparison data fails to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use({
      comparedProducts: async ({ catalog }, use) => use([await catalog.inStock()]),
      ...withMocks(mock.fail('POST', '/graphql', 500)),
    });

    test('the shopper is told the comparison could not be loaded', async ({ comparisonPage }) => {
      knownBug('BUG-09', 'a failed comparison request says "No products selected", although one is.');
      await expect(comparisonPage.title).toBeVisible();

      await expect(comparisonPage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
      await expect(comparisonPage.emptyState).toBeHidden();
    });
  });
});

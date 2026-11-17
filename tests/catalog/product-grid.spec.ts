import { expect, test } from '@fixtures';

/** What each card of the product grid shows, apart from the filters and the pager that change which cards there are. */
test.describe('Product grid', () => {
  test('every card of the home grid shows a picture with the product name as alt text', async ({ homePage, api }) => {
    const { data: listed } = await api.listProducts();

    expect(listed, 'the list should hold products').not.toHaveLength(0);
    await expect(homePage.grid.cards).toHaveCount(listed.length);
    for (const [index, product] of listed.entries()) {
      await expect(homePage.grid.nth(index).image, `the picture of "${product.name}"`).toHaveAccessibleName(product.name);
    }
  });

  test('every card shows the price the list holds for its product', async ({ homePage, api }) => {
    const { data: listed } = await api.listProducts();

    await expect(homePage.grid.cards).toHaveCount(listed.length);
    for (const [index, product] of listed.entries()) {
      await expect(homePage.grid.nth(index).price, `the price of "${product.name}"`).toShowAmount(product.price);
    }
  });

  test('a card of a product that is out of stock says so, and a card of one in stock does not', async ({ homePage, catalog }) => {
    const [soldOut, available] = [await catalog.outOfStock(), await catalog.inStock()];

    // Each is searched for by name, so its card is on the page whichever page of the list it sits on.
    await homePage.search.searchFor(soldOut.name);
    await expect(homePage.grid.card(soldOut.name).outOfStock).toBeVisible();
    await homePage.search.searchFor(available.name);

    await expect(homePage.grid.card(available.name).root).toBeVisible();
    await expect(homePage.grid.card(available.name).outOfStock).toBeHidden();
  });
});

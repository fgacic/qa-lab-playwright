import { expect, test } from '@fixtures';

/** What each card of the product grid shows, apart from the filters and the pager that change which cards there are. */
test.describe('Product grid', () => {
  test('every card of the home grid shows a picture with the product name as alt text', async ({ homePage, api }) => {
    const { data: listed } = await api.listProducts();

    await homePage.grid.expectPicturesNamed(listed);
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

import { expect, test } from '@fixtures';

/** What each card of the product grid shows, apart from the filters and the pager that change which cards there are. */
test.describe('Product grid', () => {
  test('every card of the home grid shows a picture with the product name as alt text', async ({ homePage, api }) => {
    const { data: listed } = await api.listProducts();
    expect(listed, 'the catalogue should list products').not.toHaveLength(0);
    await expect(homePage.grid.cards).toHaveCount(listed.length);

    for (const [index, product] of listed.entries()) {
      await expect(homePage.grid.nth(index).image, `the picture of "${product.name}"`).toHaveAccessibleName(product.name);
    }
  });
});

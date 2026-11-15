import { expect, mock, test, withMocks } from '@fixtures';
import { API_URL } from '@support/env';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

interface CategoryNode {
  slug: string;
  sub_categories: { slug: string }[];
}

test.describe('Category pages', () => {
  const categories = [
    { slug: 'hand-tools', title: 'Category: Hand Tools' },
    { slug: 'power-tools', title: 'Category: Power Tools' },
    { slug: 'other', title: 'Category: Other' },
  ];

  for (const { slug, title } of categories) {
    test(`/category/${slug} lists that category's products`, async ({ categoryPage, apiMock, request }) => {
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.by_category_slug === slug);

      await categoryPage.open(slug);

      await expect(categoryPage.title).toHaveText(title);
      const { json: found } = await results;
      expect(found.total).toBeGreaterThan(0);
      const tree = (await (await request.get(`${API_URL}/categories/tree`)).json()) as CategoryNode[];
      // A parent category lists the products of its subcategories too: all of them, and nothing from elsewhere.
      const parent = tree.find((node) => node.slug === slug);
      expect(parent, `the category tree should contain "${slug}"`).toBeDefined();
      const belonging = new Set(parent!.sub_categories.map((sub) => sub.slug));
      expect(found.data.filter((p) => !belonging.has(p.category.slug)).map((p) => p.name), 'products outside the category').toEqual([]);
      await expect(categoryPage.grid.names).toHaveText(found.data.map((p) => p.name));
    });
  }

  test.describe('when a category has no products', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products', emptyProductPage())));

    test('the page shows the empty state', async ({ categoryPage }) => {
      await categoryPage.open('special-tools');

      await expect(categoryPage.title).toHaveText('Category: Special Tools');
      await expect(categoryPage.grid.emptyState).toBeVisible();
    });
  });

  test('an unknown category says it does not exist', { tag: ['@negative', '@bug'] }, async ({ categoryPage }) => {
    knownBug('BUG-06', '/category/<anything> invents a page titled after the slug, with an empty grid and no "not found".');
    await categoryPage.open('qa-lab-unknown');

    await expect(categoryPage.notFoundMessage, 'BUG-06: an unknown category says it does not exist').toBeVisible({ timeout: 5_000 });
  });

  test.describe('when the category products fail to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('QUERY', '/products', 500)));

    test('the shopper is told the products could not be loaded', async ({ categoryPage }) => {
      knownBug('BUG-04', 'a failed product list leaves the grid blank with no message.');
      await categoryPage.open('hand-tools');
      await expect(categoryPage.title).toHaveText('Category: Hand Tools');

      await expect(categoryPage.shell.errorAlert, 'BUG-04: a failed product list is reported').toBeVisible({ timeout: 5_000 });
    });
  });
});

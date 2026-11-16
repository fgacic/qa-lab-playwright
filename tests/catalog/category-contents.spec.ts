import { apiOnlyTest as test, expect } from '@fixtures';
import { CATEGORIES } from '@support/catalog-terms';

/** What a category page lists, judged in plain HTTP: no page is opened, so each runs once (in Chromium) like the other @api specs. */
test.describe('Category contents', { tag: ['@api'] }, () => {
  for (const { slug } of CATEGORIES) {
    test(`/category/${slug} lists the products of its subcategories, and nothing from elsewhere`, async ({ api }) => {
      const parent = (await api.categoryTree()).find((node) => node.slug === slug);
      expect(parent, `the category tree should contain "${slug}"`).toBeDefined();
      const belonging = new Set(parent!.sub_categories.map((sub) => sub.slug));
      const { last_page: lastPage } = await api.listProducts({ by_category_slug: slug });

      // The list runs over several pages: every page is checked, not just the one the grid shows.
      const strangers: string[] = [];
      for (let pageNo = 1; pageNo <= lastPage; pageNo++) {
        const { data } = await api.listProducts({ by_category_slug: slug, page: String(pageNo) });
        strangers.push(...data.filter((p) => !belonging.has(p.category.slug)).map((p) => p.name));
      }

      expect(strangers, 'products outside the category').toEqual([]);
    });
  }
});

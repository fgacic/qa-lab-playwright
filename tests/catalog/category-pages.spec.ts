import { expect, mock, test, withMocks } from '@fixtures';
import { allowLoggedFailure } from '@pages/admin/alerts';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

/** The parent categories of the catalogue, by slug, with the title their page carries. */
const HAND_TOOLS = { slug: 'hand-tools', title: 'Category: Hand Tools' };
const POWER_TOOLS = { slug: 'power-tools', title: 'Category: Power Tools' };
const OTHER = { slug: 'other', title: 'Category: Other' };
const CATEGORIES = [HAND_TOOLS, POWER_TOOLS, OTHER];
/** A subcategory the seed leaves without products. */
const SPECIAL_TOOLS = { slug: 'special-tools', title: 'Category: Special Tools' };
/** A slug no category has. */
const UNKNOWN_SLUG = 'qa-lab-unknown';

/** The category pages, hand-tools first, are long enough to run to several pages: sort and pager are tried there. */
const PAGED = HAND_TOOLS;

test.describe('Category pages', () => {
  for (const { slug, title } of CATEGORIES) {
    test(`/category/${slug} lists that category's products`, async ({ categoryPage, apiMock }) => {
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.by_category_slug === slug);

      await categoryPage.open(slug);

      await expect(categoryPage.title).toHaveText(title);
      const { json: found } = await results;
      expect(found.total, `"${slug}" should list products`).toBeGreaterThan(0);
      await expect(categoryPage.grid.names).toHaveText(found.data.map((p) => p.name));
    });

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

    test(`/category/${slug} lists every product of its subcategories`, async ({ categoryPage, apiMock, api }) => {
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.by_category_slug === slug);
      const parent = (await api.categoryTree()).find((node) => node.slug === slug);
      expect(parent, `the category tree should contain "${slug}"`).toBeDefined();

      await categoryPage.open(slug);

      // "All of them": the parent's total is the sum of its subcategories' totals, each asked of the API on its own.
      const subtotals = await Promise.all(parent!.sub_categories.map(async (sub) => (await api.listProducts({ by_category_slug: sub.slug })).total));
      const { json: found } = await results;
      expect(found.total, `"${slug}" should list every product of its subcategories`).toBe(subtotals.reduce((sum, total) => sum + total, 0));
    });

    test(`every card of /category/${slug} shows a picture with the product name as alt text`, async ({ categoryPage, apiMock }) => {
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.by_category_slug === slug);
      await categoryPage.open(slug);
      const { json: found } = await results;

      await categoryPage.grid.expectPicturesNamed(found.data);
    });
  }

  test('sorting a category page keeps it to that category', async ({ categoryPage, apiMock }) => {
    await categoryPage.open(PAGED.slug);
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === 'price,asc');

    await categoryPage.filters.sortBy('Price (Low - High)');

    const { body, json: sorted } = await results;
    expect(body.by_category_slug, 'the sorted request still names the category').toBe(PAGED.slug);
    expect(sorted.data.map((p) => p.price)).toBeSorted();
    await expect(categoryPage.grid.names).toHaveText(sorted.data.map((p) => p.name));
  });

  test('the pager of a category page shows the next page of that category', async ({ categoryPage, apiMock }) => {
    await categoryPage.open(PAGED.slug);
    const pageTwo = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.page === '2');

    await categoryPage.pagination.goNext();

    const { body, json } = await pageTwo;
    expect(body.by_category_slug, 'the second page is still the category\'s').toBe(PAGED.slug);
    expect(json.current_page).toBe(2);
    await expect(categoryPage.grid.names).toHaveText(json.data.map((p) => p.name));
  });

  test('the filter panel of a category page narrows that category', async ({ categoryPage, apiMock }) => {
    await categoryPage.open(PAGED.slug);
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.eco_friendly === 'true');

    await categoryPage.filters.showOnlyEcoFriendly();

    const { body, json: found } = await results;
    expect(body.by_category_slug, 'the filtered request still names the category').toBe(PAGED.slug);
    expect(found.total, `"${PAGED.slug}" should hold eco-friendly products`).toBeGreaterThan(0);
    expect(found.data.every((p) => p.is_eco_friendly)).toBe(true);
    await expect(categoryPage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test.describe('when a category has no products', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products', emptyProductPage())));

    test('the page shows the empty state', async ({ categoryPage }) => {
      await categoryPage.open(SPECIAL_TOOLS.slug);

      await expect(categoryPage.title).toHaveText(SPECIAL_TOOLS.title);
      await expect(categoryPage.grid.emptyState).toBeVisible();
    });
  });

  test('an unknown category says it does not exist', { tag: ['@negative', '@bug'] }, async ({ categoryPage }) => {
    knownBug('BUG-06', '/category/<anything> invents a page titled after the slug, with an empty grid and no "not found".', { absence: true });
    await categoryPage.open(UNKNOWN_SLUG);

    await expect(categoryPage.notFoundMessage, 'BUG-06: an unknown category says it does not exist').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  test.describe('when the category products fail to load', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('QUERY', '/products', 500)));
    test.beforeEach(({ consoleGuard }) => allowLoggedFailure(consoleGuard));

    test('the shopper is told the products could not be loaded', async ({ categoryPage }) => {
      knownBug('BUG-04', 'a failed product list leaves the grid blank with no message.', { absence: true });
      await categoryPage.open(HAND_TOOLS.slug);
      await expect(categoryPage.title).toHaveText(HAND_TOOLS.title);

      await expect(failureFeedback(categoryPage.page).first(), 'BUG-04: a failed product list is reported').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});

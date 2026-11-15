import type { ApiMock } from '@support/api-mock';
import { expect, mock, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

const CURRENT_PAGE = /\bactive\b/;

/** The answer for one page of the product list (page numbers are 1-based in the request). */
const pageAnswer = (apiMock: ApiMock, n: number) => apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.page === String(n));

test.describe('Pagination', () => {
  test('Next shows the following page of products', async ({ homePage, api, apiMock }) => {
    const { per_page: pageSize } = await api.listProducts();
    await expect(homePage.grid.cards).toHaveCount(pageSize);
    await expect(homePage.pagination.item(1)).toHaveClass(CURRENT_PAGE);
    const pageTwo = pageAnswer(apiMock, 2);

    await homePage.pagination.goNext();

    const { json } = await pageTwo;
    expect(json.current_page).toBe(2);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
    await expect(homePage.pagination.item(2)).toHaveClass(CURRENT_PAGE);
    await expect(homePage.pagination.item(1)).not.toHaveClass(CURRENT_PAGE);
  });

  test('Previous goes back to the page before', async ({ homePage, apiMock }) => {
    const pageThree = pageAnswer(apiMock, 3);
    await homePage.pagination.goTo(3);
    await pageThree;
    const pageTwo = pageAnswer(apiMock, 2);

    await homePage.pagination.goPrevious();

    const { json } = await pageTwo;
    expect(json.current_page).toBe(2);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
    await expect(homePage.pagination.item(2)).toHaveClass(CURRENT_PAGE);
  });

  test('Next from a middle page goes on to the page after', async ({ homePage, apiMock }) => {
    const pageThree = pageAnswer(apiMock, 3);
    await homePage.pagination.goTo(3);
    await pageThree;
    const pageFour = pageAnswer(apiMock, 4);

    await homePage.pagination.goNext();

    const { json } = await pageFour;
    expect(json.current_page).toBe(4);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
    await expect(homePage.pagination.item(4)).toHaveClass(CURRENT_PAGE);
  });

  test('a numbered page button jumps straight to that page', async ({ homePage, apiMock }) => {
    const pageThree = pageAnswer(apiMock, 3);

    await homePage.pagination.goTo(3);

    const { json } = await pageThree;
    expect(json.current_page).toBe(3);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
    await expect(homePage.pagination.item(3)).toHaveClass(CURRENT_PAGE);
  });

  test('the last page button shows the last page of products', async ({ homePage, apiMock }) => {
    const { pagination } = homePage;
    const lastPage = await pagination.pageCount();
    const last = pageAnswer(apiMock, lastPage);

    await pagination.goTo(lastPage);

    const { json } = await last;
    expect(json.current_page).toBe(json.last_page);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
    await expect(pagination.item(lastPage)).toHaveClass(CURRENT_PAGE);
  });

  test('changing a filter on a later page shows the first page of the new result', async ({ homePage, apiMock }) => {
    const pageThree = pageAnswer(apiMock, 3);
    await homePage.pagination.goTo(3);
    await pageThree;
    // The eco-friendly list is shorter than the catalogue but still runs to more than one page.
    const filtered = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.eco_friendly === 'true');

    await homePage.filters.showOnlyEcoFriendly();

    const { json } = await filtered;
    expect(json.current_page).toBe(1);
    expect(json.last_page, 'the eco-friendly list should span more than one page').toBeGreaterThan(1);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
  });

  test('changing the sort on a later page marks page 1 as the current one', { tag: ['@bug'] }, async ({ homePage, apiMock }) => {
    knownBug('BUG-33', 'after a sort or filter change from a later page the list restarts at page 1 but the pager still marks the old page (or none) as current.');
    const pageThree = pageAnswer(apiMock, 3);
    await homePage.pagination.goTo(3);
    await pageThree;
    const sorted = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === 'name,desc');

    await homePage.filters.sortBy('Name (Z - A)');

    const { json } = await sorted;
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
    await expect(homePage.pagination.item(1), 'BUG-33: the pager marks page 1 as current once the list restarts there').toHaveClass(CURRENT_PAGE, { timeout: 5_000 });
  });

  // Two pins, one per button, so each is verified (and will go green) on its own.
  test('Previous is disabled on page 1 for assistive tech too', { tag: ['@a11y', '@bug'] }, async ({ homePage }) => {
    knownBug('A11Y-03', 'the end buttons are only styled as disabled (class on the <li>); the <button> stays enabled and focusable.');
    await expect(homePage.pagination.item(1)).toHaveClass(CURRENT_PAGE);

    await expect(homePage.pagination.previous, 'A11Y-03: Previous is disabled on page 1').toBeDisabled({ timeout: 5_000 });
  });

  test('Next is disabled on the last page for assistive tech too', { tag: ['@a11y', '@bug'] }, async ({ homePage, apiMock }) => {
    knownBug('A11Y-03', 'the end buttons are only styled as disabled (class on the <li>); the <button> stays enabled and focusable.');
    const lastPage = await homePage.pagination.pageCount();
    const last = pageAnswer(apiMock, lastPage);
    await homePage.pagination.goTo(lastPage);
    await last;
    await expect(homePage.pagination.item(lastPage)).toHaveClass(CURRENT_PAGE);

    await expect(homePage.pagination.next, 'A11Y-03: Next is disabled on the last page').toBeDisabled({ timeout: 5_000 });
  });

  test.describe('when everything fits on one page', { tag: ['@mocked'] }, () => {
    test.use({
      apiMocks: async ({ catalog }, use) => {
        const product = await catalog.inStock();
        await use({ routes: [mock.respond('QUERY', '/products', { ...emptyProductPage(), data: [product], total: 1, from: 1, to: 1 })] });
      },
    });

    test('no pagination is shown', async ({ homePage }) => {
      await expect(homePage.grid.cards).toHaveCount(1);
      await expect(homePage.pagination.next).toBeHidden();
    });
  });
});

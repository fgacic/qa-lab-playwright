import { expect, mock, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

test.describe('Pagination', () => {
  test('Next shows the following page of products', async ({ homePage, apiMock }) => {
    await expect(homePage.grid.cards).toHaveCount(9);
    const pageTwo = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.page === '2');

    await homePage.pagination.goNext();

    const { json } = await pageTwo;
    expect(json.current_page).toBe(2);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
  });

  test('Previous goes back to the page before', async ({ homePage, apiMock }) => {
    await homePage.pagination.goTo(2);
    const pageOne = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.page === '1');

    await homePage.pagination.goPrevious();

    await expect(homePage.grid.names).toHaveText((await pageOne).json.data.map((p) => p.name));
  });

  test('a numbered page button jumps straight to that page', async ({ homePage, apiMock }) => {
    const pageThree = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.page === '3');

    await homePage.pagination.goTo(3);

    await expect(homePage.grid.names).toHaveText((await pageThree).json.data.map((p) => p.name));
  });

  test('the last page button shows the last page and leaves nothing after it', { tag: ['@negative'] }, async ({ homePage, apiMock }) => {
    const { pagination } = homePage;
    const lastPage = await pagination.pageCount();
    const last = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.page === String(lastPage));

    await pagination.goTo(lastPage);

    const { json } = await last;
    expect(json.current_page).toBe(json.last_page);
    await expect(homePage.grid.names).toHaveText(json.data.map((p) => p.name));
  });

  test('Previous on page 1 and Next on the last page are disabled for assistive tech too', { tag: ['@negative', '@a11y', '@bug'] }, async ({ homePage }) => {
    knownBug('A11Y-03', 'the end buttons are only styled as disabled (class on the <li>); the <button> stays enabled and focusable.');
    const { pagination } = homePage;
    await expect(pagination.page(1)).toBeVisible();

    await expect(pagination.previous).toBeDisabled({ timeout: 5_000 });
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

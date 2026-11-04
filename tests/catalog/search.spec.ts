import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

test.describe('Search', () => {
  test('lists exactly the products the search found', { tag: ['@smoke'] }, async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search');

    await homePage.search.searchFor('pliers');

    const { json: found } = await results;
    expect(found.total, 'the catalogue should contain pliers').toBeGreaterThan(0);
    await expect(homePage.search.caption).toHaveText('Searched for: pliers');
    await expect(homePage.search.resultCount).toHaveText(`${found.total} products found for 'pliers'`);
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('pressing Enter in the search box searches too', async ({ homePage }) => {
    await homePage.search.searchFor('hammer', { submitWith: 'enter' });

    await expect(homePage.search.caption).toHaveText('Searched for: hammer');
  });

  test('a term nothing matches shows the empty state', { tag: ['@negative'] }, async ({ homePage }) => {
    await homePage.search.searchFor('qa-lab-no-such-product');

    await expect(homePage.grid.emptyState).toBeVisible();
    await expect(homePage.search.resultCount).toHaveText("0 products found for 'qa-lab-no-such-product'");
    await expect(homePage.grid.cards).toHaveCount(0);
  });

  test('clearing the search restores the full catalogue', async ({ homePage }) => {
    await homePage.search.searchFor('qa-lab-no-such-product');
    await expect(homePage.grid.emptyState).toBeVisible();

    await homePage.search.reset();

    await expect(homePage.search.query).toHaveValue('');
    await expect(homePage.search.caption).toBeHidden();
    await expect(homePage.grid.cards).toHaveCount(9);
  });

  test('a long search term is searched or explained', { tag: ['@negative', '@bug'] }, async ({ homePage, apiMock }) => {
    knownBug('BUG-27', 'a search term over 40 characters is silently ignored: no request, no message.');
    const term = 'qa lab search term longer than forty chars';
    const searched = apiMock.waitForRequest('QUERY', '/products/search');
    await homePage.search.query.fill(term);
    await homePage.search.submitButton.click();

    await Promise.race([searched, homePage.page.waitForTimeout(3_000).then(() => Promise.reject(new Error('no search request was sent')))]);
  });

  test.describe('when the search API answers with no products', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('QUERY', '/products/search', emptyProductPage())));

    test('the empty state is shown', async ({ homePage }) => {
      await homePage.search.searchFor('hammer');

      await expect(homePage.grid.emptyState).toBeVisible();
      await expect(homePage.search.resultCount).toHaveText("0 products found for 'hammer'");
    });
  });

  test.describe('when the search API fails', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.fail('QUERY', '/products/search', 500)));

    test('the shopper is told the search failed', async ({ homePage }) => {
      knownBug('BUG-03', 'a failed search is shown as "0 products found", as if nothing matched.');
      await homePage.search.searchFor('hammer');
      await expect(homePage.search.caption).toHaveText('Searched for: hammer');

      await expect(homePage.shell.errorAlert).toBeVisible({ timeout: 5_000 });
    });
  });
});

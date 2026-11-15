import type { Page } from '@playwright/test';
import { expect, mock, test, withMocks } from '@fixtures';
import { apiPath } from '@support/env';
import { knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

/** The terms sent to the search API from now on, in order. */
function recordSearchTerms(page: Page): string[] {
  const terms: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'QUERY' && apiPath(request.url()) === '/products/search') terms.push(String(request.postDataJSON()?.q));
  });
  return terms;
}

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

  test('pressing Enter in the search box searches too', async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search');

    await homePage.search.searchFor('hammer', { submitWith: 'enter' });

    const { json: found } = await results;
    expect(found.total, 'the catalogue should contain hammers').toBeGreaterThan(0);
    await expect(homePage.search.caption).toHaveText('Searched for: hammer');
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('a term nothing matches shows the empty state', { tag: ['@negative'] }, async ({ homePage }) => {
    await homePage.search.searchFor('qa-lab-no-such-product');

    await expect(homePage.grid.emptyState).toBeVisible();
    await expect(homePage.search.resultCount).toHaveText("0 products found for 'qa-lab-no-such-product'");
    await expect(homePage.grid.cards).toHaveCount(0);
  });

  for (const term of ["o'brien", '100%', '%%%', '___', 'a&b=c', '"quoted"', '<b>x</b>']) {
    test(`the term ${term} is searched literally`, { tag: ['@negative'] }, async ({ homePage, apiMock }) => {
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search');

      await homePage.search.searchFor(term);

      const { response, body, json: found } = await results;
      expect(response.status()).toBe(200);
      expect(body.q).toBe(term);
      // No product is named like any of these, so a wildcard or markup taking effect would show.
      expect(found.total).toBe(0);
      await expect(homePage.search.caption).toHaveText(`Searched for: ${term}`);
      await expect(homePage.search.resultCount).toHaveText(`0 products found for '${term}'`);
      await expect(homePage.grid.emptyState).toBeVisible();
    });
  }

  test('spaces around the term do not change what is found', async ({ homePage, apiMock }) => {
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search');
    await homePage.search.searchFor('pliers');
    const exact = (await results).json;
    const padded = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search', (body) => body.q === '  pliers  ');

    await homePage.search.searchFor('  pliers  ');

    const { json: found } = await padded;
    expect(found.data.map((p) => p.name)).toEqual(exact.data.map((p) => p.name));
    await expect(homePage.grid.names).toHaveText(exact.data.map((p) => p.name));
  });

  test('submitting an empty search sends nothing', { tag: ['@negative'] }, async ({ homePage }) => {
    const terms = recordSearchTerms(homePage.page);

    await homePage.search.submitButton.click();
    // A later search that is answered proves the empty one, sent first, had its chance to go out.
    await homePage.search.searchFor('pliers');

    expect(terms).toEqual(['pliers']);
  });

  test('submitting only spaces sends nothing either', { tag: ['@negative', '@bug'] }, async ({ homePage }) => {
    knownBug('BUG-34', 'a search of only spaces is sent as it is and reported as "0 products found for \' \'", where an empty search sends nothing.');
    const terms = recordSearchTerms(homePage.page);

    await homePage.search.query.fill('   ');
    await homePage.search.submitButton.click();
    await homePage.search.searchFor('pliers');

    expect(terms, 'BUG-34: a blank search is not sent, like an empty one').toEqual(['pliers']);
  });

  test('clearing the search restores the full catalogue', async ({ homePage, api }) => {
    const { per_page: pageSize } = await api.listProducts();
    await homePage.search.searchFor('qa-lab-no-such-product');
    await expect(homePage.grid.emptyState).toBeVisible();

    await homePage.search.reset();

    await expect(homePage.search.query).toHaveValue('');
    await expect(homePage.search.caption).toBeHidden();
    await expect(homePage.grid.cards).toHaveCount(pageSize);
  });

  for (const { title, term, bug } of [
    { title: 'a long search term', term: 'qa lab search term longer than forty chars', bug: ['BUG-27', 'a search term over 40 characters is silently ignored: no request, no message.'] },
    { title: 'a very short search term', term: 'ph', bug: ['BUG-35', 'a search term under 3 characters is silently ignored: no request, no message.'] },
  ]) {
    test(`${title} is searched or explained`, { tag: ['@negative', '@bug'] }, async ({ homePage, apiMock }) => {
      const [id, summary] = bug;
      knownBug(id, summary);
      const searched = apiMock.waitForRequest('QUERY', '/products/search', { timeout: 3_000 });
      const explained = expect(homePage.page.getByRole('alert').first()).toBeVisible({ timeout: 3_000 });
      await homePage.search.query.fill(term);
      await homePage.search.submitButton.click();

      // Either answer is fine: the term goes to the API, or the page shows an alert saying why not.
      const responded = await Promise.any([searched, explained]).then(() => true, () => false);
      expect(responded, `${id}: the term is searched, or the shopper is told why not`).toBe(true);
    });
  }

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

      await expect(homePage.shell.errorAlert, 'BUG-03: a failed search is reported as a failure').toBeVisible({ timeout: 5_000 });
    });
  });
});

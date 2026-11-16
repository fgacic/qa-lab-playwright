import { expect, mock, test, withMocks } from '@fixtures';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { emptyProductPage } from '@support/payloads';
import type { ProductPage } from '@support/toolshop-api';

/** A term no product matches. */
const NO_MATCH = 'qa-lab-no-such-product';
/** The search box ignores terms outside these lengths (BUG-27, BUG-35). */
const MIN_TERM = 3;
const MAX_TERM = 40;
/** A term with spaces on both sides, as typed. */
const PADDED_TERM = '  pliers  ';

/**
 * Whether the shop reacts at all: any of `reactions` (each a promise that rejects when its window runs out) comes true.
 * Every one is observed from the moment it is passed in, so the ones that lose the race, or all of them when the action
 * throws, never end as an unhandled rejection. Call it before the action, await the result after.
 */
async function reactedWithin(...reactions: Promise<unknown>[]): Promise<boolean> {
  for (const reaction of reactions) reaction.catch(() => undefined);
  return Promise.any(reactions).then(() => true, () => false);
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
    await homePage.search.searchFor(NO_MATCH);

    await expect(homePage.grid.emptyState).toBeVisible();
    await expect(homePage.search.resultCount).toHaveText(`0 products found for '${NO_MATCH}'`);
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
    const padded = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search', (body) => String(body.q).trim() === PADDED_TERM.trim());

    await homePage.search.searchFor(PADDED_TERM);

    const { json: found } = await padded;
    expect(found.data.map((p) => p.name)).toEqual(exact.data.map((p) => p.name));
    await expect(homePage.search.caption).toHaveText('Searched for: pliers');
    await expect(homePage.grid.names).toHaveText(exact.data.map((p) => p.name));
  });

  test('submitting an empty search sends nothing', { tag: ['@negative'] }, async ({ homePage, apiMock }) => {
    await homePage.search.submitButton.click();

    await apiMock.expectNoRequest('QUERY', '/products/search');
  });

  test('submitting only spaces sends nothing either', { tag: ['@negative', '@bug'] }, async ({ homePage, apiMock }) => {
    knownBug('BUG-34', 'a search of only spaces is sent as it is and reported as "0 products found for \' \'", where an empty search sends nothing.');
    await homePage.search.query.fill('   ');
    await homePage.search.submitButton.click();

    await expect(apiMock.expectNoRequest('QUERY', '/products/search'), 'BUG-34: a blank search is not sent, like an empty one').resolves.toBeUndefined();
  });

  // The search and the sort/filter menu share one grid. These two pin how they combine, as the shop
  // does today: a sort applies to the searched list, and a new search starts over without the filters.
  test('sorting after a search keeps the search and orders its results', async ({ homePage, apiMock }) => {
    await homePage.search.searchFor('pliers');
    const sorted = apiMock.waitForResponse<ProductPage>('QUERY', '/products', (body) => body.sort === 'price,asc');

    await homePage.filters.sortBy('Price (Low - High)');

    const { body, json: found } = await sorted;
    expect(body.q, 'the sort request carries the search term').toBe('pliers');
    expect(found.total, 'the catalogue should contain pliers').toBeGreaterThan(0);
    expect(found.data.every((p) => /pliers/i.test(p.name))).toBe(true);
    expect(found.data.map((p) => p.price)).toBeSorted();
    await expect(homePage.search.caption).toHaveText('Searched for: pliers');
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
  });

  test('searching after a filter shows the search results and unticks the filter', async ({ homePage, apiMock }) => {
    await homePage.filters.filterByCategory('Hammer');
    await expect(homePage.filters.category('Hammer')).toBeChecked();
    const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search');

    await homePage.search.searchFor('saw');

    const { json: found } = await results;
    expect(found.total, 'the catalogue should contain saws').toBeGreaterThan(0);
    await expect(homePage.search.caption).toHaveText('Searched for: saw');
    await expect(homePage.grid.names).toHaveText(found.data.map((p) => p.name));
    await expect(homePage.filters.category('Hammer'), 'a ticked filter that no longer applies is not left on screen').not.toBeChecked();
  });

  test('clearing the search restores the full catalogue', async ({ homePage, api }) => {
    const { per_page: pageSize } = await api.listProducts();
    await homePage.search.searchFor(NO_MATCH);
    await expect(homePage.grid.emptyState).toBeVisible();

    await homePage.search.reset();

    await expect(homePage.search.query).toHaveValue('');
    await expect(homePage.search.caption).toBeHidden();
    await expect(homePage.grid.cards).toHaveCount(pageSize);
  });

  // The search box takes terms of 3 to 40 characters: the terms at the two edges are valid and are searched.
  for (const [edge, length] of [['shortest', MIN_TERM], ['longest', MAX_TERM]] as const) {
    test(`the ${edge} valid term (${length} characters) is searched`, { tag: ['@negative'] }, async ({ homePage, apiMock }) => {
      const term = 'x'.repeat(length);
      const results = apiMock.waitForResponse<ProductPage>('QUERY', '/products/search');

      await homePage.search.searchFor(term);

      const { response, body } = await results;
      expect(response.status()).toBe(200);
      expect(body.q).toBe(term);
      await expect(homePage.search.caption).toHaveText(`Searched for: ${term}`);
      await expect(homePage.search.resultCount).toHaveText(`0 products found for '${term}'`);
    });
  }

  for (const { title, term, bug } of [
    { title: 'a long search term', term: 'x'.repeat(MAX_TERM + 1), bug: { id: 'BUG-27', summary: 'a search term over 40 characters is silently ignored: no request, no message.' } },
    { title: 'a very short search term', term: 'x'.repeat(MIN_TERM - 1), bug: { id: 'BUG-35', summary: 'a search term under 3 characters is silently ignored: no request, no message.' } },
  ]) {
    test(`${title} is searched or explained`, { tag: ['@negative', '@bug'] }, async ({ homePage, apiMock }) => {
      knownBug(bug.id, bug.summary);
      // Either answer is fine: the term goes to the API, or the page says why not.
      const searched = apiMock.waitForRequest('QUERY', '/products/search', { timeout: BUG_TIMEOUT });
      const explained = expect(homePage.search.termExplanation).toBeVisible({ timeout: BUG_TIMEOUT });
      const reacted = reactedWithin(searched, explained);
      await homePage.search.query.fill(term);
      await homePage.search.submitButton.click();

      expect(await reacted, `${bug.id}: the term is searched, or the shopper is told why not`).toBe(true);
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
      knownBug('BUG-03', 'a failed search is shown as "0 products found", as if nothing matched.', { absence: true });
      await homePage.search.searchFor('hammer');
      await expect(homePage.search.caption).toHaveText('Searched for: hammer');

      await expect(failureFeedback(homePage.page).first(), 'BUG-03: a failed search is reported as a failure').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });
});

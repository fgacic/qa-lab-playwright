import type { APIRequestContext } from '@playwright/test';
import { apiOnlyTest as test, expect } from '@fixtures';
import { API_URL } from '@support/env';
import { SUITE_OWNED_NAME } from '@support/catalog-terms';
import { knownBug } from '@support/known-bug';
import type { ProductPage } from '@support/toolshop-api';

/**
 * A term the seeded catalogue matches on more than one page of results (26 products, 9 a page). It is two characters
 * long, which the search box refuses (BUG-35), and no term of 3 or more characters matches more than 8 products, so the
 * shop's pager cannot be driven by a real search: these specs send the requests the shop sends, over HTTP. (The pager
 * itself is tested on a mocked multi-page search, in pagination.spec.ts.)
 */
const SPANNING_TERM = 'er';

/** The shop asks for the first page of a search at `/products/search`, and for every later page at `/products` with the term in the body. */
type Endpoint = '/products/search' | '/products';

test.describe('A search that spans several pages', { tag: ['@api'] }, () => {
  /** One page of the search, as the shop asks for it. */
  const pageOf = async (request: APIRequestContext, endpoint: Endpoint, page: number) => {
    const response = await request.fetch(`${API_URL}${endpoint}`, { method: 'QUERY', data: { q: SPANNING_TERM, page: String(page) } });
    return { ok: response.ok(), json: (await response.json()) as ProductPage };
  };
  /**
   * Every product name on the pages, the suite's own temporary products left out (SUITE_OWNED_NAME): the back-office and stored-XSS
   * specs make rentals whose names contain the term ("Pliers", "onerror"), and a search reaches rentals.
   */
  const namesOf = (pages: ProductPage[]): string[] => pages.flatMap((page) => page.data.map((p) => p.name)).filter((name) => !SUITE_OWNED_NAME.test(name));
  /** How many of the pages' products are the suite's own: they count in the shop's `total` while they exist. */
  const ownedIn = (pages: ProductPage[]): number => pages.flatMap((page) => page.data).filter((p) => SUITE_OWNED_NAME.test(p.name)).length;

  test('lists each match once, on exactly one page', async ({ request }) => {
    const first = await pageOf(request, '/products/search', 1);
    expect(first.ok, 'the search answers').toBe(true);
    expect(first.json.last_page, `"${SPANNING_TERM}" should match more than one page of products`).toBeGreaterThan(1);

    const pages = [first.json];
    for (let n = 2; n <= first.json.last_page; n++) {
      const next = await pageOf(request, '/products/search', n);
      expect(next.ok, `page ${n} of the search answers`).toBe(true);
      pages.push(next.json);
    }

    const names = namesOf(pages);
    expect(names, 'no product is listed twice').toEqual([...new Set(names)]);
    expect(names.length + ownedIn(pages), 'the pages hold every match the first page counted').toBe(first.json.total);
    expect(pages.flatMap((page) => page.data).filter((p) => !p.name.toLowerCase().includes(SPANNING_TERM)).map((p) => p.name), 'products that do not match the term').toEqual([]);
  });

  test('the later pages, asked of the product list as the shop asks them, hold the same products', { tag: ['@bug'] }, async ({ request }) => {
    knownBug('BUG-61', 'the later pages of a search come from the product list, which leaves out the rentals the search itself lists: the pager counts them, and the last page comes up short.');
    const first = await pageOf(request, '/products/search', 1);
    expect(first.json.last_page, `"${SPANNING_TERM}" should match more than one page of products`).toBeGreaterThan(1);
    const fromSearch: ProductPage[] = [];
    const fromList: ProductPage[] = [];
    for (let n = 2; n <= first.json.last_page; n++) {
      fromSearch.push((await pageOf(request, '/products/search', n)).json);
      fromList.push((await pageOf(request, '/products', n)).json);
    }

    expect(namesOf(fromList), 'BUG-61: pages 2 and on of the search show every product the search found').toEqual(namesOf(fromSearch));
  });
});

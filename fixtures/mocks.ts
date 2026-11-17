import { expect, test as base, type Page } from '@playwright/test';
import { ApiMock, mock, type MockSet } from '@support/api-mock';
import { IS_SELF_HOSTED, writeGuardDefault } from '@support/env';

export interface MockFixtures {
  /**
   * API mocks installed before the page navigates. Override per describe block with
   * `test.use(withMocks(mock.fail('QUERY', '/products')))`, or with a fixture function when a
   * mock needs runtime data: `test.use({ apiMocks: async ({ catalog }, use) => use({ routes }) })`.
   */
  apiMocks: MockSet;
  /** Delay every API request by this much (a slow network), before any page opens. */
  apiLatencyMs: number;
  /** For mocks a test adds itself, to count requests (`requestsTo`) or to wait for one. */
  apiMock: ApiMock;
}

/** The mock layer of each page, so `apiMock` and the `page` it belongs to are always the same pair. */
const mockOf = new WeakMap<Page, ApiMock>();

export const test = base.extend<MockFixtures>({
  apiMocks: [{ routes: [] }, { option: true }],
  apiLatencyMs: [0, { option: true }],

  // The mock layer is part of the `page` itself, not an auto fixture of its own: whatever opens a
  // page gets its mocks installed before the first navigation, in whatever order a spec lists its
  // fixtures. The auto fixtures of the full `test` (the XSS sentinel, the console guard, ...) each ask for a
  // page, so browserless specs use `apiOnlyTest` (fixtures/index.ts), which has none of them.
  page: async ({ page, apiMocks, apiLatencyMs }, use, testInfo) => {
    const apiMock = new ApiMock(page, apiLatencyMs, writeGuardDefault(IS_SELF_HOSTED, testInfo.project.name));
    mockOf.set(page, apiMock);
    if (apiMock.needsRoute) await apiMock.install();
    if (apiMocks.routes.length) await apiMock.use(...apiMocks.routes);
    await use(page);
    // Always checked, so a write that no mock answered fails the test that sent it rather than vanishing as a 418.
    expect(apiMock.blockedWrites, 'writes that reached no mock (refused, never sent)').toEqual([]);
    expect(apiMock.handlerErrors, 'failures of the mock layer itself').toEqual([]);
  },

  apiMock: async ({ page }, use) => {
    await use(mockOf.get(page)!);
  },
});

/**
 * An answer for GET /postcode-lookup, for specs that are not about the lookup: the address is then
 * filled from this and a lookup outage cannot fail them. Specs that mock other routes list it too,
 * since a describe's `withMocks` replaces the file's.
 */
export const POSTCODE_LOOKUP_RESULT = {
  street: 'Mockstraat',
  house_number: '1',
  city: 'Mockstad',
  state: 'Mockland',
  country: 'NL',
  postcode: '1234 AB',
};
export const postcodeLookupMock = mock.respond('GET', '/postcode-lookup', POSTCODE_LOOKUP_RESULT);

/**
 * What GET /carts/:id answers for a cart with nothing in it, and the mock for any cart id: for specs that are about the empty cart page.
 * (For an empty list, `listOf([])` in @support/payloads.)
 */
export const EMPTY_CART = { id: 'qa-lab', additional_discount_percentage: null, lat: null, lng: null, cart_items: [] };
export const emptyCartMock = mock.respond('GET', /^\/carts\/[^/]+$/, EMPTY_CART);

import { expect, test as base, type Page } from '@playwright/test';
import { ApiMock, type MockSet } from '@support/api-mock';
import { IS_SELF_HOSTED, REAL_WRITE_PROJECTS } from '@support/env';

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
  // fixtures, and a spec that never opens a page (the header checks use only `request`) pays nothing.
  page: async ({ page, apiMocks, apiLatencyMs }, use, testInfo) => {
    const apiMock = new ApiMock(page, apiLatencyMs, !IS_SELF_HOSTED && !REAL_WRITE_PROJECTS.has(testInfo.project.name));
    mockOf.set(page, apiMock);
    if (apiMock.needsRoute) await apiMock.install();
    if (apiMocks.routes.length) await apiMock.use(...apiMocks.routes);
    await use(page);
    // Always checked, so a write that no mock answered fails the test that sent it rather than vanishing as a 418.
    expect(apiMock.blockedWrites, 'writes that reached no mock (refused, never sent)').toEqual([]);
  },

  apiMock: async ({ page }, use) => {
    await use(mockOf.get(page)!);
  },
});

import { test as base } from '@playwright/test';
import { ApiMock, type MockSet } from '@support/api-mock';

export interface MockFixtures {
  /**
   * API mocks installed before the page fixture navigates. Override per describe block with
   * `test.use(withMocks(mock.fail('QUERY', '/products')))`, or with a fixture function when a
   * mock needs runtime data: `test.use({ apiMocks: async ({ catalog }, use) => use({ routes }) })`.
   */
  apiMocks: MockSet;
  /** Delay every API request by this much (a slow network), before any page opens. */
  apiLatencyMs: number;
  /** For mocks a test adds itself, or to wait for a request to an endpoint. */
  apiMock: ApiMock;
}

export const test = base.extend<MockFixtures>({
  apiMocks: [{ routes: [] }, { option: true }],
  apiLatencyMs: [0, { option: true }],
  apiMock: [
    async ({ page, apiMocks, apiLatencyMs }, use) => {
      const apiMock = new ApiMock(page, apiLatencyMs);
      if (apiLatencyMs) await apiMock.install();
      if (apiMocks.routes.length) await apiMock.use(...apiMocks.routes);
      await use(apiMock);
    },
    { auto: true },
  ],
});

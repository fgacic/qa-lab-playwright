import { expect as base, type Locator } from '@playwright/test';

/** Collection matchers: `expect(prices).toBeSorted({ descending: true })`. */
export const collectionExpect = base.extend({
  toBeSorted(received: Array<string | number>, { descending = false }: { descending?: boolean } = {}) {
    const compare = (a: string | number, b: string | number) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { sensitivity: 'base' });
    const firstUnsorted = received.findIndex((value, i) => i > 0 && (descending ? compare(received[i - 1], value) < 0 : compare(received[i - 1], value) > 0));
    const pass = firstUnsorted === -1;
    const order = descending ? 'descending' : 'ascending';
    return {
      pass,
      name: 'toBeSorted',
      message: () =>
        pass
          ? `expected ${JSON.stringify(received)} not to be sorted ${order}`
          : `expected ${order} order, but ${JSON.stringify(received[firstUnsorted - 1])} comes before ${JSON.stringify(received[firstUnsorted])} in ${JSON.stringify(received)}`,
    };
  },
});

/** Money matchers: `await expect(cart.total).toShowAmount(28.3)`, retried like any web-first assertion. */
export const moneyExpect = base.extend({
  async toShowAmount(locator: Locator, expected: number, options?: { timeout?: number }) {
    const parse = (text: string) => Number(text.replace(/[^0-9.-]/g, ''));
    let actual: number | undefined;
    let pass = false;
    try {
      await base
        .poll(async () => (actual = parse(await locator.innerText())), { timeout: options?.timeout ?? 15_000 })
        .toBeCloseTo(expected, 2);
      pass = true;
    } catch {
      pass = false;
    }
    return {
      pass,
      name: 'toShowAmount',
      expected,
      actual,
      message: () => `expected ${locator} to show $${expected.toFixed(2)}, it shows ${actual === undefined ? 'nothing' : `$${actual.toFixed(2)}`}`,
    };
  },
});

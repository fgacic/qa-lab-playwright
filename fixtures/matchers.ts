import { expect as base, type Locator } from '@playwright/test';

/** Collection matchers: `expect(prices).toBeSorted({ descending: true })`. */
export const collectionExpect = base.extend({
  toBeSorted(received: Array<string | number>, { descending = false }: { descending?: boolean } = {}) {
    // One value (or none) is trivially "sorted": a grid that has not rendered yet would pass for the wrong reason.
    // Failing makes expect.poll wait for the content, and a test that really has one item must not claim an order.
    if (received.length < 2) throw new Error(`toBeSorted needs at least 2 values to prove an order, got ${received.length}: ${JSON.stringify(received)}`);
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

/**
 * The first amount in a text: a `$`-prefixed one when there is any, else the first number. "$28.30 (incl. 21% VAT)"
 * is 28.3, not 28.3021. No number at all is NaN, never 0: an empty or placeholder text must not read as a zero amount.
 */
function parseAmount(text: string): number {
  // The sign may stand before the "$", with or without a space, or after it ("-$4.00", "- $4.00", "$-4.00"), as a hyphen or a true minus sign.
  const token = text.match(/[-−]?\s?\$\s?[-−]?\d[\d,]*(?:\.\d+)?/)?.[0] ?? text.match(/[-−]?\d[\d,]*(?:\.\d+)?/)?.[0];
  return token ? Number(token.replace(/−/g, '-').replace(/[^0-9.-]/g, '')) : NaN;
}

/** Money matchers: `await expect(cart.total).toShowAmount(28.3)`, retried like any web-first assertion. */
export const moneyExpect = base.extend({
  async toShowAmount(locator: Locator, expected: number, options?: { timeout?: number }) {
    let actual: number | undefined;
    let pass = false;
    try {
      await base
        .poll(async () => (actual = parseAmount(await locator.innerText())), { timeout: options?.timeout ?? this.timeout })
        .toBeCloseTo(expected, 2);
      pass = true;
    } catch (error) {
      // Only "the amount never matched" is a failed match. A strict-mode violation, a missing
      // element or a closed page is a broken test and must surface as itself, not as "no amount".
      if (!(error as { matcherResult?: unknown }).matcherResult) throw error;
    }
    return {
      pass,
      name: 'toShowAmount',
      expected,
      actual,
      message: () => `expected ${locator} to show $${expected.toFixed(2)}, it shows ${actual === undefined || Number.isNaN(actual) ? 'no amount' : `$${actual.toFixed(2)}`}`,
    };
  },
});

// The pure arithmetic of the fixtures (the one browser here is a blank page for toShowAmount): the performance baseline (fixtures/performance-baseline.ts: the limit a recorded
// median earns, the margin cap, the noisy-recording rule) and the matchers that every catalogue and cart spec trusts
// (fixtures/matchers.ts: the amount a text holds, the order a list is in). The budgets themselves are measured in tests/performance.
import { expect, test } from '@playwright/test';
import { collectionExpect, moneyExpect, parseAmount } from '@fixtures/matchers';
import { isNoisy, onCI, ratchetLimits, summarise } from '@fixtures/performance-baseline';

test.describe('the performance baseline arithmetic', { tag: ['@framework'] }, () => {
  test('a measurement is summarised by the median and the spread of its samples, rounded as the baseline file holds them', () => {
    const sample = (lcp: number, cls: number) => ({ lcp, cls, tbt: 0, inp: 16 });
    const odd = summarise([sample(900.4, 0.1234), sample(1000, 0.1), sample(1100, 0.2)]);
    expect(odd.median, 'the middle sample of an odd count, whatever order they came in').toEqual({ lcp: 1000, cls: 0.123, tbt: 0, inp: 16 });
    expect(odd.spread, 'largest minus smallest').toEqual({ lcp: 200, cls: 0.1, tbt: 0, inp: 0 });
    expect(summarise([sample(1000, 0), sample(1100, 0)]).median.lcp, 'the mean of the two middle samples of an even count').toBe(1050);
  });

  test('no recorded entry means no limits at all, so the spec says the baseline is missing', () => {
    expect(ratchetLimits(undefined, ['lcp'])).toEqual({ limits: undefined, unratcheted: [] });
  });

  test('a limit is the median plus the largest of 3 x spread, 5% of the median and the noise floor', () => {
    const { limits } = ratchetLimits(
      {
        lcp: { median: 1000, spread: 20 }, // 3 x 20 = 60, 5% = 50, floor 100: the floor
        tbt: { median: 2000, spread: 5 }, // 5% = 100, floor 50: the share, then capped at 2 x floor = 100
        cls: { median: 0.1, spread: 0.002 }, // floor 0.02
      },
      ['lcp', 'tbt', 'cls'],
    );
    expect(limits).toEqual({ lcp: 1100, tbt: 2100, cls: 0.12 });
  });

  test('the margin never exceeds two noise floors, however large the median is', () => {
    const { limits } = ratchetLimits({ lcp: { median: 10_000, spread: 0 } }, ['lcp']);
    expect(limits, '5% of 10 000 is 500, capped at 2 x 100').toEqual({ lcp: 10_200 });
  });

  test('a recording whose spread would be clipped by the cap is noisy: it earns no ratchet, and is listed', () => {
    expect(isNoisy('inp', 21), '3 x 21 = 63 is under 2 x 32 = 64').toBe(false);
    expect(isNoisy('inp', 22), '3 x 22 = 66 is over 64').toBe(true);
    expect(ratchetLimits({ inp: { median: 16, spread: 32 }, lcp: { median: 1000, spread: 8 } }, ['inp', 'lcp'])).toEqual({ limits: { lcp: 1100 }, unratcheted: ['inp'] });
  });

  test('a metric the entry does not hold (a noisy one is never recorded) is listed, not an error', () => {
    expect(ratchetLimits({ lcp: { median: 1000, spread: 8 } }, ['lcp', 'inp'])).toEqual({ limits: { lcp: 1100 }, unratcheted: ['inp'] });
  });

  for (const [value, expected] of [['false', false], ['0', false], ['', false], ['FALSE', false], ['true', true], ['1', true]] as const) {
    test(`CI=${JSON.stringify(value)} is ${expected ? '' : 'not '}CI`, () => {
      expect(onCI(value)).toBe(expected);
    });
  }
});

test.describe('the matchers', { tag: ['@framework'] }, () => {
  for (const [text, expected] of [
    ['$28.30 (incl. 21% VAT)', 28.3], // the "$" amount, not the first number
    ['-$4.00', -4],
    ['$-4.00', -4],
    ['- $4.00', -4],
    ['\u2212$4.00', -4], // a true minus sign
    ['1,234.50', 1234.5], // thousands commas, no "$": the first number
    ['Total: 3 items, $9.99', 9.99],
    ['1.234,50', 1.234], // a comma-decimal text reads as 1.234: the shop ignores the language for amounts (I18N-29), and a fix has to change this row
    ['n/a', NaN], // never 0: a placeholder must not read as a zero amount
    ['', NaN],
  ] as const) {
    test(`an amount is read from ${JSON.stringify(text)} as ${expected}`, () => {
      expect(parseAmount(text)).toBe(expected);
    });
  }

  test('a list in order passes toBeSorted, in either direction', () => {
    collectionExpect(['a', 'b', 'c']).toBeSorted();
    collectionExpect([3, 2, 1]).toBeSorted({ descending: true });
    collectionExpect([1, 1, 2]).toBeSorted();
  });

  for (const [values, options, message] of [
    [['b', 'a'], undefined, /expected ascending order/],
    [[1, 3, 2], undefined, /expected ascending order/],
    [[1, 2, 3], { descending: true }, /expected descending order/],
    [[1], undefined, /at least 2 values/], // one value proves no order
    [[], undefined, /at least 2 values/], // nor does an empty grid that has not rendered yet
  ] as const) {
    test(`toBeSorted fails on ${JSON.stringify(values)}${options ? ' descending' : ''}`, () => {
      expect(() => collectionExpect([...values]).toBeSorted(options)).toThrow(message);
    });
  }

  test('toBeSorted ignores case, so a case-sensitive order bug is not what it can catch', () => {
    collectionExpect(['a', 'B', 'c']).toBeSorted();
  });

  // `toShowAmount` tells "the amount never matched" from a broken test by the shape of the error `expect.poll` throws: a Playwright upgrade that changes it is caught here.
  test('toShowAmount passes on the amount shown, fails with what is shown, and lets a strict-mode violation surface as itself', async ({ page }) => {
    await page.setContent('<p id="total">Total $28.30 (incl. 21% VAT)</p><ul><li>$1.00</li><li>$2.00</li></ul>');
    await moneyExpect(page.locator('#total')).toShowAmount(28.3);
    await expect(moneyExpect(page.locator('#total')).toShowAmount(30, { timeout: 300 })).rejects.toThrow(/to show \$30\.00, it shows \$28\.30/);
    await expect(moneyExpect(page.locator('li')).toShowAmount(1, { timeout: 300 })).rejects.toThrow(/strict mode violation/);
  });
});

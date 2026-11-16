// The arithmetic behind the performance baseline (fixtures/performance.ts): the limit a recorded median earns, the margin cap and the
// noisy-recording rule. No browser; the budgets themselves are measured in tests/performance.
import { expect, test } from '@playwright/test';
import { isNoisy, onCI, ratchetLimits } from '../../fixtures/performance';

test.describe('the performance baseline arithmetic', { tag: ['@framework'] }, () => {
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

import { expect } from '@fixtures';
import { onCI, type Measurement, type Vitals } from '@fixtures/performance';
import baseline from './baseline.json';

/**
 * The limits the performance specs share (budgets.spec.ts, layout-shift.spec.ts, collector-controls.spec.ts): Google's budgets, the fixed
 * ceilings per measurement and the helpers that judge a layout shift. Not a spec: Playwright only collects `*.spec.ts`. The three tiers
 * of limit (budget, fixed ceiling, recorded baseline) are explained in budgets.spec.ts; this file holds the numbers.
 */

export const BUDGET: Vitals = { lcp: 2_500, cls: 0.1, tbt: 200, inp: 200 };

/**
 * How much slower than this machine a CI runner may be before a fixed ceiling is tripped: the time metrics (LCP, TBT, INP) are
 * scaled by it on CI, until a `ci` baseline is recorded and committed (a shared runner is not a laptop, and no number measured on a
 * runner exists yet to derive a ceiling from). It is not applied to CLS: a layout shift is the race between first paint and the
 * API, decided by the throttled network and the 500 ms latency we set, not by how fast the CPU is. A scaled ceiling never goes
 * above the budget (the budget is the limit that holds everywhere), so on CI the LCP ceilings meet it.
 *
 * It ends by itself: the day tests/performance/baseline.json holds a `ci` set (the record-perf-baseline workflow's artifact, committed),
 * the factor is 1 and the baseline ratchet is what holds a CI run, so this loosening cannot outlive the reason it exists.
 */
const HAS_CI_BASELINE = 'ci' in baseline;
const CI_SLOWDOWN = onCI() && !HAS_CI_BASELINE ? 1.5 : 1;
const scaled = (ms: number, budget: number) => Math.min(Math.round(ms * CI_SLOWDOWN), budget);

/**
 * Fixed ceilings, one per measurement, that hold on every machine with or without a recorded baseline. The CI baseline cannot be
 * recorded without a push, so on a runner these are what makes a perf test mean more than "inside Google's good limits".
 * Each is derived from the values recorded on an idle machine (tests/performance/baseline.json) with the margin stated here;
 * the time metrics are scaled on CI (CI_SLOWDOWN):
 * - LCP: the recorded median times 1.5, rounded up to 50 ms, and well under the 2 500 ms budget. Recorded medians (baseline.json): home 1 224,
 *   search 1 224, product 1 264, cart 1 048, contact 1 044 ms; on a phone (the same throttling, no click) home 1 216, product 1 260 ms.
 * - TBT: 100 ms, half the 200 ms budget and twice the 50 ms noise floor. Recorded 0 on every page: the shop does not block the
 *   main thread under 4x throttling, and a 100 ms block is a real regression, not noise.
 * - INP proxy: 80 ms, 2.5 times the highest recorded median (32 ms, search; the others 16 to 24 ms, and event timing is rounded to 8 ms, so
 *   one step of it moves a median by a quarter) and well under half the 200 ms budget. The
 *   recorded INP spreads (32 to 48 ms) are all wider than the baseline's cap allows (see isNoisy in fixtures/performance.ts), so
 *   INP has no baseline ratchet at all today: this ceiling and the budget are the only limits on it.
 * - On CI (CI_SLOWDOWN 1.5, never above the budget) the effective ceilings are: LCP 2 500 ms for home, search and product (their scaled
 *   value is over the budget, so the budget is the ceiling) and 2 400 ms for cart and contact; TBT 150 ms; INP proxy 120 ms; CLS as below, unscaled.
 * - CLS, on the slow API: the recorded median plus about 20%, rounded up to 0.01 (recorded: home 0.258, product 0.316 with a
 *   spread of 0.082 (the race between first paint and the API), contact 0.17, cart 0.107).
 */
const CEILING: Record<string, Partial<Vitals>> = {
  home: { lcp: scaled(1_900, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  search: { lcp: scaled(1_900, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  product: { lcp: scaled(1_950, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  cart: { lcp: scaled(1_600, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  contact: { lcp: scaled(1_600, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt), inp: scaled(80, BUDGET.inp) },
  'home-mobile': { lcp: scaled(1_850, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt) },
  'product-mobile': { lcp: scaled(1_900, BUDGET.lcp), tbt: scaled(100, BUDGET.tbt) },
  'home-slow-api': { cls: 0.31 },
  'product-slow-api': { cls: 0.38 },
  'contact-slow-api': { cls: 0.21 },
  // The cart shifts by 0.107 in every sample (the same footer bug as PERF-01, a hair over the 0.1 budget): 0.13 is that plus about 20%,
  // room for a font or a pixel of rendering, well under the 0.17 the bug costs where it is unmistakable.
  'cart-slow-api': { cls: 0.13 },
};

/** The fixed ceiling of one metric of a measurement, or an error that names the missing entry (a new scenario must come with its ceilings). */
export function ceilingOf(name: string, metric: keyof Vitals): number {
  const ceiling = CEILING[name]?.[metric];
  if (ceiling === undefined) throw new Error(`No fixed ceiling for ${name}.${metric}: add it to CEILING (with the measured value it is derived from).`);
  return ceiling;
}

/**
 * The layout-shift limits of a pinned page: the fixed ceiling holds everywhere, and the baseline, where one is recorded and not
 * noisy, is the tighter ratchet under it, so a footer that jumps further cannot pass unseen.
 */
export function expectNoWorseShift({ name, median }: Measurement, limit: Partial<Vitals> | undefined, page: string) {
  expect.soft(median.cls, `CLS of ${page} against its fixed ceiling (CEILING['${name}'])`).toBeLessThanOrEqual(ceilingOf(name, 'cls'));
  if (limit?.cls !== undefined) expect.soft(median.cls, `CLS of ${page} against its baseline`).toBeLessThanOrEqual(limit.cls);
}

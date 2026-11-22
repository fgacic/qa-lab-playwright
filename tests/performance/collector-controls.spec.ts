import { expect, test } from '@fixtures';
import { slowEveryClick } from '@support/slow-click';
import { BUDGET } from './limits';

test.use({ measureVitals: true });

/**
 * Controls for the collector. A TBT of 0 is the normal result, so on its own it cannot be told from a collector that
 * sees no long tasks, and the shop's quick INP cannot be told from one that sees no interactions. Here a known long task and a known
 * slow click are run and must be counted: that proves the observers are alive in this browser, which is what gives the small numbers of budgets.spec.ts
 * their meaning.
 */
test.describe('Performance collector (control)', { tag: ['@perf', '@self-hosted'] }, () => {
  const BLOCKING_MS = 150;
  /** Blocking time is a task's length above 50 ms, so a 150 ms task must add at least 100 ms. */
  const EXPECTED_TBT = BLOCKING_MS - 50;

  test('counts a known long task as blocking time', async ({ homePage, vitals }) => {
    // After the first paint: blocking time is counted from First Contentful Paint on, so the task must start once the page has drawn.
    const block = async () => {
      await expect(homePage.grid.cards.first()).toBeVisible();
      await vitals.blockMainThread(BLOCKING_MS);
    };

    const { median, observed } = await vitals.measure('long-task-control', block, { inputs: 0, samples: 3 });

    expect(observed.longTaskObserver, 'the browser reports long tasks').toBe(true);
    expect(median.tbt, `a ${BLOCKING_MS} ms task counted as blocking time (ms)`).toBeGreaterThanOrEqual(EXPECTED_TBT);
  });

  /** The click's handler blocks for this long, and the interaction takes at least that long to reach the next paint. */
  const SLOW_CLICK_MS = 300;
  /** Event timing rounds a duration to 8 ms, so a 300 ms handler may be reported as 296. */
  const EVENT_TIMING_ROUNDING_MS = 8;

  test('counts a known slow click as the interaction time', async ({ homePage, vitals }) => {
    await slowEveryClick(homePage.page, SLOW_CLICK_MS);
    const click = async () => {
      await expect(homePage.banner).toBeVisible();
      await homePage.banner.click();
    };

    const { median, observed, inputsPerSample } = await vitals.measure('slow-click-control', click, { inputs: 1, samples: 3 });

    expect(inputsPerSample, 'every sample received its click').toEqual([1, 1, 1]);
    expect(observed.interactions, 'the browser timed the click as an interaction').toBeGreaterThan(0);
    expect(median.inp, `a click that blocks for ${SLOW_CLICK_MS} ms counted as interaction time (ms)`).toBeGreaterThanOrEqual(SLOW_CLICK_MS - EVENT_TIMING_ROUNDING_MS);
    expect(median.inp, 'and it is over the INP budget, which is what the budgets exist to catch').toBeGreaterThan(BUDGET.inp);
  });
});

import type { Page } from '@playwright/test';

/**
 * Makes every click on the page cost `ms` of main-thread time, in every document it loads from now on: a listener that busy-waits, so the
 * browser can paint only after it. It is the known-slow interaction the INP control of tests/performance/budgets.spec.ts measures, to prove
 * the collector sees a slow click (a normal run of the shop reports a quick one, and a collector that saw nothing would report the same).
 * An init script, so it is in place again after each of the fresh loads `vitals.measure` makes; the clock is read in the page, which is why
 * this lives here and not in a spec (a spec may not run code in the page).
 */
export async function slowEveryClick(page: Page, ms: number): Promise<void> {
  await page.addInitScript((duration) => {
    window.addEventListener(
      'click',
      () => {
        const end = performance.now() + duration;
        while (performance.now() < end);
      },
      true,
    );
  }, ms);
}

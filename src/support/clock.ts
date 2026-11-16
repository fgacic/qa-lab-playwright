import type { Page } from '@playwright/test';

/**
 * Stops the page's timers where they are, so a toast or a message that fades on its own is still there however long the reads after
 * it take (an axe scan, a settled text read). The clock must have been installed before the page loaded (`page.clock.install()`,
 * or `context.clock.install()` for every tab of a context); time moves on by a tick only, enough for what is already due. A paused clock
 * stays paused for the next page of the context too, so a test that freezes it resumes it when it is done (`page.clock.resume()`).
 * The target lies a quarter of a second ahead of the page's time, not a few milliseconds: the clock keeps running while the
 * call travels to the page, and a target already behind it is refused ("Cannot fast-forward to the past"). The toasts and messages
 * fade after three seconds or more, so what the jump fires is nothing a test is waiting on.
 */
export async function freezeClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 250);
}

/**
 * Keeps the one timer the page sets for `delayMs` from ever firing, for a scan that must see what that timer would remove (the
 * forgot-password alert fades after three seconds, which a slow axe scan can outlast). Every other timer, and any other delay,
 * runs as usual: the router, the HTTP retries and axe's own timers are untouched, which a paused clock (`freezeClock`) cannot say,
 * because axe waits on its timers and the scan then never ends. Call it before the page loads; it runs in the page, so it lives here
 * with the other helpers that do (see slow-click.ts), and not in a spec. A page that schedules a second timer of exactly `delayMs`
 * loses that one as well: the delay is the whole match, so give the one the page is known to use.
 */
export async function holdTimer(page: Page, delayMs: number): Promise<void> {
  await page.addInitScript((held) => {
    const setTimeoutNow = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (timeout === held ? 0 : setTimeoutNow(handler, timeout, ...args))) as typeof window.setTimeout;
  }, delayMs);
}

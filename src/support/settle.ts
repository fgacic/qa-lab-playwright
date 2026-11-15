import { expect, type Page, type Request } from '@playwright/test';

/**
 * Runs `action` and waits until every request it caused to `urlPart` has finished and none has
 * started for `quietMs`. The postcode lookup fires more than once per address change, and a
 * late answer overwrites what the user typed meanwhile, so "the first answer" is not enough.
 * Fails if no matching request was seen at all, or if they never went quiet within `timeoutMs`.
 */
export async function settleRequests(page: Page, urlPart: string, action: () => Promise<void>, quietMs = 750, timeoutMs = 15_000): Promise<void> {
  let inFlight = 0;
  let seen = 0;
  let lastActivity = Date.now();
  const isTarget = (r: Request) => r.url().includes(urlPart);
  const started = (r: Request) => {
    if (!isTarget(r)) return;
    inFlight++;
    seen++;
    lastActivity = Date.now();
  };
  const ended = (r: Request) => {
    if (!isTarget(r)) return;
    inFlight--;
    lastActivity = Date.now();
  };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  try {
    await action();
    await expect
      .poll(() => (seen === 0 ? 'none seen' : inFlight > 0 ? `${inFlight} in flight` : Date.now() - lastActivity >= quietMs ? 'settled' : 'quiet period'), {
        timeout: timeoutMs,
        message: `expected requests to "${urlPart}" to be seen and then go quiet for ${quietMs} ms`,
      })
      .toBe('settled');
  } finally {
    page.off('request', started);
    page.off('requestfinished', ended);
    page.off('requestfailed', ended);
  }
}

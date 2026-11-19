import { expect, type Page, type Request } from '@playwright/test';

/**
 * Runs `action` and waits until every request it caused to the path `endpoint` (matched on the end of the URL's path, not on any
 * substring of the URL) has finished and none has started for `quietMs`. The quiet period is time-based on purpose, and it is the
 * one wall-clock wait in the page objects: the lookup is fired by the app's own debounce, so there is no event that says "the last
 * one was sent", and the 750 ms default is far above the debounce. The postcode lookup fires more than once per address change, and a
 * late answer overwrites what the user typed meanwhile, so "the first answer" is not enough.
 * Fails if no matching request was seen at all, or if they never went quiet within `timeoutMs`.
 */
export async function settleRequests(page: Page, endpoint: string, action: () => Promise<void>, quietMs = 750, timeoutMs = 15_000): Promise<void> {
  // Requests, not a counter: a request that was already in flight when the listeners attached ends without ever
  // having started here, and a counter would go negative and read as "quiet" while another request is still open.
  const open = new Set<Request>();
  let seen = 0;
  let lastActivity = Date.now();
  const isTarget = (r: Request) => new URL(r.url()).pathname.endsWith(endpoint);
  const started = (r: Request) => {
    if (!isTarget(r)) return;
    open.add(r);
    seen++;
    lastActivity = Date.now();
  };
  const ended = (r: Request) => {
    if (!isTarget(r)) return;
    open.delete(r);
    lastActivity = Date.now();
  };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  try {
    await action();
    await expect
      .poll(() => (seen === 0 ? 'none seen' : open.size > 0 ? `${open.size} in flight` : Date.now() - lastActivity >= quietMs ? 'settled' : 'quiet period'), {
        timeout: timeoutMs,
        message: `expected requests to "${endpoint}" to be seen and then go quiet for ${quietMs} ms`,
      })
      .toBe('settled');
  } finally {
    page.off('request', started);
    page.off('requestfinished', ended);
    page.off('requestfailed', ended);
  }
}

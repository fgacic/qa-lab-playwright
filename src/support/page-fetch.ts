import type { Page } from '@playwright/test';

/**
 * The status the browser gets for a `fetch` it makes itself, from inside the page: the one place specs that test the
 * mock layer (not the shop) need to send a request "as the app would". Named and kept out of the specs, which may not call
 * `page.evaluate` (eslint.config.mjs).
 */
export function fetchStatus(page: Page, url: string, method = 'GET', body?: unknown): Promise<number> {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) });
      return response.status;
    },
    { url, method, body },
  );
}

/** What a page's `fetch` of a cross-origin URL came to (CORS preflight included): the status, or the error name when the browser refused. */
export function fetchOutcome(page: Page, url: string, method: string, headers: Record<string, string> = {}): Promise<number | string> {
  return page.evaluate(
    async ({ url, method, headers }) => {
      try {
        return (await fetch(url, { method, headers })).status;
      } catch (error) {
        return (error as Error).name;
      }
    },
    { url, method, headers },
  );
}

/** Milliseconds `action` takes. Timing is the thing under test in the delay specs, so the clock lives here, not in a spec. */
export async function elapsedMs(action: () => Promise<unknown>): Promise<number> {
  const started = Date.now();
  await action();
  return Date.now() - started;
}

/**
 * Asks `url` once per body, `gapMs` apart so the later one is certainly asked later, and returns the bodies' `page` values
 * in the order their answers arrived.
 */
export function deliveryOrder(page: Page, url: string, pages: string[], gapMs = 50): Promise<string[]> {
  return page.evaluate(
    async ({ url, pages, gapMs }) => {
      const delivered: string[] = [];
      const ask = (pageNumber: string) =>
        fetch(url, { method: 'QUERY', body: JSON.stringify({ page: pageNumber }), headers: { 'content-type': 'application/json' } }).then(() => delivered.push(pageNumber));
      const asked: Promise<number>[] = [];
      for (const pageNumber of pages) {
        asked.push(ask(pageNumber));
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
      await Promise.all(asked);
      return delivered;
    },
    { url, pages, gapMs },
  );
}

import type { Page } from '@playwright/test';

/** An endpoint whose answer is held until the test lets it go: `holdAnswers`. */
export interface AnswerGate {
  /** Lets every held answer (and any later request) through. */
  release: () => void;
  /** How many requests have reached the endpoint's handler, held or not. The count a double-submit pin asserts. */
  readonly reached: number;
}

/**
 * Holds the answer of one POST endpoint until `release()`, then answers it with `json`. It is how a pin
 * about a repeated submit makes its reproduction exact: while the answer is held the page cannot have
 * replaced or disabled the button on the strength of it, so the second click of a double click lands on
 * the same button on every engine, at any speed. `dblclick()` resolves after the second mouseup, so a
 * test that releases after it knows both clicks have landed. A timer (`ApiMock.delay`) would only make
 * that likely, not certain.
 *
 * It counts in the handler, so `reached` does not depend on the order the browser reports requests in.
 * This is a route of its own, not an `ApiMock` rule: the gate has to be opened by the test, which a mock
 * answers by method and path alone. The write never reaches the shop: the answer is the mock's.
 */
export async function holdAnswers(page: Page, path: RegExp, json: unknown, status = 201): Promise<AnswerGate> {
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  let reached = 0;
  await page.route(path, async (route) => {
    // A CORS preflight is the browser's, not the page's: it passes through to the shop.
    if (route.request().method() !== 'POST') return route.fallback();
    reached++;
    await open;
    await route.fulfill({ status, json, headers: { 'access-control-allow-origin': '*' } });
  });
  return { release, get reached() { return reached; } };
}

/** One answer of `answerOutOfOrder`: the value of the query parameter that calls for it, and what the shop answers. */
export interface OrderedAnswer {
  value: string;
  json: unknown;
}

/**
 * Makes two answers of one GET endpoint arrive in the wrong order, exactly: the answer for the `late` value of the query
 * parameter `param` is held until the answer for the `early` value has been served, as a slow network can do. It is a route of
 * its own and not `ApiMock.delay` on purpose: the two requests differ by a query parameter, which a mock answers by method and
 * path only (a sequence would be spent by any stray request of a half-filled form), and a delay is a timer, so it would only
 * make the late answer *probably* come second. Any other value (the page may ask while a field is half filled) is answered at
 * once with `otherwise(value)` and releases nothing.
 */
export async function answerOutOfOrder(
  page: Page,
  path: RegExp,
  { param, late, early, otherwise }: { param: string; late: OrderedAnswer; early: OrderedAnswer; otherwise: (value: string | null) => unknown },
): Promise<void> {
  let earlyServed!: () => void;
  const isServed = new Promise<void>((resolve) => (earlyServed = resolve));
  await page.route(path, async (route) => {
    const value = new URL(route.request().url()).searchParams.get(param);
    if (value === late.value) {
      await isServed;
      return route.fulfill({ json: late.json });
    }
    if (value !== early.value) return route.fulfill({ json: otherwise(value) });
    await route.fulfill({ json: early.json });
    earlyServed();
  });
}

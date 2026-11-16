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

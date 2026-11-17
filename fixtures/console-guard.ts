import { expect, type Page } from '@playwright/test';
import { apiPath, isApiUrl } from '@support/env';
import { allowancesFor, consoleArgsText, describeError, unexpectedErrors, type Allowance, type ApiAnswer, type BrowserError, type ExpectedStatus } from '@support/console-guard';
import { test as mocksTest } from './mocks';

export interface ConsoleGuard {
  /**
   * Declares an error this test provokes on purpose (a mocked failure the SPA logs, an error of a defect no suite-wide
   * allowance covers). The pattern is recorded as a test annotation. The defects that have a pin of their own are allowed
   * suite-wide (src/support/console-guard.ts), but only on the route of the page that raises them, and the "Unauthorized" echo of
   * `GET /users/me` only in a test whose browser received that 401; everything else is declared here, per test.
   * With `requiresFailure` the line is allowed only in a test in which a request really failed (see `Allowance.requiresFailure`).
   */
  allow(pattern: RegExp, reason: string, options?: { requiresFailure?: boolean }): void;
  /**
   * The errors the browser has logged or thrown so far in this test that match `pattern`, as one line each. How a pin of a
   * defect that shows only in the console reads it, including the ones the suite allows (console-guard.ts): the guard has
   * listened since the context opened, so an error raised while the page loaded is there too.
   */
  logged(pattern: RegExp): Promise<string[]>;
  /**
   * Proves the browser logs nothing that matches `pattern` for `within` ms (default 750, as `ApiMock.expectNoRequest`), and rejects
   * the moment a match is logged. Matches logged before the call count too: the guard has listened since the context opened.
   * An absence cannot be observed, only waited for: a one-shot `logged(...)` read passes the instant it is taken, before an error
   * the page raises on a later tick. Call it once, at the end of the scenario; the cost is exactly `within` on a passing test.
   * A pin wraps it as `await expect(consoleGuard.expectNoneLogged(...), 'BUG-37: ...').resolves.toBeUndefined()`.
   */
  expectNoneLogged(pattern: RegExp, options?: { within?: number }): Promise<void>;
  /**
   * Declares that this test expects the shop to refuse `path` with `status` (404 for an id it does not know, 422 or 409 for input it
   * refuses): the browser logs every such answer as a "Failed to load resource", and only a test that provokes it expects the line.
   * Allowed only when the browser really received that status for that path (a RegExp on the API path, or the exact path). Recorded as a test annotation.
   */
  allowStatus(status: number, path: RegExp | string, reason: string): void;
}

export interface ConsoleGuardFixtures {
  consoleGuard: ConsoleGuard;
}

/**
 * Every test fails if its browser logged an error (`console.error`) or threw an uncaught one (`pageerror`) that is not
 * allowed: a page that "works" while the app throws behind the scenes is a defect no locator would ever catch.
 * Listens on the context, so every page, popup and iframe of the test is covered. See src/support/console-guard.ts for
 * the suite-wide allowances.
 */
export const test = mocksTest.extend<ConsoleGuardFixtures>({
  consoleGuard: [
    async ({ context, apiMock, browserName }, use, testInfo) => {
      const seen: BrowserError[] = [];
      const allowances: Allowance[] = allowancesFor(browserName);
      const expectedStatuses: ExpectedStatus[] = [];
      const watchers = new Set<(error: BrowserError) => void>();
      const answered: ApiAnswer[] = [];
      const reading: Promise<void>[] = [];
      context.on('response', (response) => {
        if (isApiUrl(response.url())) answered.push({ method: response.request().method(), pathname: apiPath(response.url()), status: response.status() });
      });
      context.on('console', (message) => {
        if (message.type() !== 'error') return;
        const error: BrowserError = { kind: 'console', text: message.text(), url: message.location().url || undefined, route: routeOf(message.page()) };
        seen.push(error);
        reading.push(
          consoleArgsText(message.args()).then((args) => {
            error.args = args;
            watchers.forEach((watch) => watch(error));
          }),
        );
      });
      context.on('weberror', (webError) => {
        const { message, stack } = webError.error();
        const error: BrowserError = { kind: 'pageerror', text: stack ?? message, route: routeOf(webError.page()) };
        seen.push(error);
        watchers.forEach((watch) => watch(error));
      });
      const isMatch = (pattern: RegExp, error: BrowserError) => pattern.test(error.text) || (error.args !== undefined && pattern.test(error.args));
      await use({
        async logged(pattern) {
          await Promise.all(reading);
          return seen.filter((error) => isMatch(pattern, error)).map(describeError);
        },
        async expectNoneLogged(pattern, { within = 750 } = {}) {
          await Promise.all(reading);
          const early = seen.find((error) => isMatch(pattern, error));
          if (early) throw new Error(`Expected no error matching ${pattern}, but one was already logged: ${describeError(early)}`);
          let watch!: (error: BrowserError) => void;
          const arrived = new Promise<BrowserError>((resolve) => {
            watch = (error) => isMatch(pattern, error) && resolve(error);
            watchers.add(watch);
          });
          let stop!: () => void;
          const quiet = new Promise<undefined>((resolve) => {
            const timer = setTimeout(resolve, within);
            stop = () => clearTimeout(timer);
          });
          try {
            const error = await Promise.race([arrived, quiet]);
            if (error !== undefined) throw new Error(`Expected no error matching ${pattern} within ${within} ms, but one was logged: ${describeError(error)}`);
          } finally {
            stop();
            watchers.delete(watch);
          }
        },
        allowStatus(status, path, reason) {
          expectedStatuses.push({ status, path, reason });
          testInfo.annotations.push({ type: 'console status allowed', description: `${status} ${path}: ${reason}` });
        },
        allow(pattern, reason, options) {
          allowances.push({ pattern, reason, requiresFailure: options?.requiresFailure });
          testInfo.annotations.push({ type: 'console error allowed', description: `${pattern}: ${reason}` });
        },
      });
      await Promise.all(reading);
      expect(unexpectedErrors(seen, allowances, apiMock.answers, answered, expectedStatuses).map(describeError), 'errors the browser logged or threw during the test').toEqual([]);
    },
    { auto: true },
  ],
});

/** The path of the page an error came from, read when it arrives (the page may have moved on by the time the test ends). */
function routeOf(page: Page | null): string | undefined {
  if (!page) return undefined;
  try {
    return new URL(page.url()).pathname;
  } catch {
    return undefined; // about:blank has a path, but a page that is already gone has no URL to read
  }
}

import { expect, type Page } from '@playwright/test';
import { apiPath, isApiUrl } from '@support/env';
import { consoleArgsText, describeError, SUITE_WIDE_ALLOWANCES, unexpectedErrors, type Allowance, type ApiAnswer, type BrowserError } from '@support/console-guard';
import { test as mocksTest } from './mocks';

export interface ConsoleGuard {
  /**
   * Declares an error this test provokes on purpose (a mocked failure the SPA logs, an error of a defect no suite-wide
   * allowance covers). The pattern is recorded as a test annotation. The defects that have a pin of their own are allowed
   * suite-wide (src/support/console-guard.ts), but only on the route of the page that raises them, and the "Unauthorized" echo of
   * `GET /users/me` only in a test whose browser received that 401; everything else is declared here, per test.
   */
  allow(pattern: RegExp, reason: string): void;
  /**
   * The errors the browser has logged or thrown so far in this test that match `pattern`, as one line each. How a pin of a
   * defect that shows only in the console reads it, including the ones the suite allows (console-guard.ts): the guard has
   * listened since the context opened, so an error raised while the page loaded is there too.
   */
  logged(pattern: RegExp): Promise<string[]>;
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
    async ({ context, apiMock }, use, testInfo) => {
      const seen: BrowserError[] = [];
      const allowances: Allowance[] = [...SUITE_WIDE_ALLOWANCES];
      const answered: ApiAnswer[] = [];
      const reading: Promise<void>[] = [];
      context.on('response', (response) => {
        if (isApiUrl(response.url())) answered.push({ method: response.request().method(), pathname: apiPath(response.url()), status: response.status() });
      });
      context.on('console', (message) => {
        if (message.type() !== 'error') return;
        const error: BrowserError = { kind: 'console', text: message.text(), url: message.location().url || undefined, route: routeOf(message.page()) };
        seen.push(error);
        reading.push(consoleArgsText(message.args()).then((args) => void (error.args = args)));
      });
      context.on('weberror', (webError) => {
        const { message, stack } = webError.error();
        seen.push({ kind: 'pageerror', text: stack ?? message, route: routeOf(webError.page()) });
      });
      await use({
        async logged(pattern) {
          await Promise.all(reading);
          return seen.filter((error) => pattern.test(error.text) || (error.args !== undefined && pattern.test(error.args))).map(describeError);
        },
        allow(pattern, reason) {
          allowances.push({ pattern, reason });
          testInfo.annotations.push({ type: 'console error allowed', description: `${pattern}: ${reason}` });
        },
      });
      await Promise.all(reading);
      expect(unexpectedErrors(seen, allowances, apiMock.answers, answered).map(describeError), 'errors the browser logged or threw during the test').toEqual([]);
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

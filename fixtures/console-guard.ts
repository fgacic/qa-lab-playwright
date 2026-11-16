import { expect, test as base, type JSHandle } from '@playwright/test';
import { describeError, SUITE_WIDE_ALLOWANCES, unexpectedErrors, type Allowance, type BrowserError } from '@support/console-guard';

export interface ConsoleGuard {
  /**
   * Declares an error this test provokes on purpose (a mocked failure the SPA logs, a defect a pin documents). The pattern
   * is recorded as a test annotation. A pinned defect's error is allowed here only, never suite-wide.
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
export const test = base.extend<ConsoleGuardFixtures>({
  consoleGuard: [
    async ({ context }, use, testInfo) => {
      const seen: BrowserError[] = [];
      const allowances: Allowance[] = [...SUITE_WIDE_ALLOWANCES];
      const reading: Promise<void>[] = [];
      context.on('console', (message) => {
        if (message.type() !== 'error') return;
        const error: BrowserError = { kind: 'console', text: message.text(), url: message.location().url || undefined };
        seen.push(error);
        reading.push(serialiseArgs(message.args()).then((args) => void (error.args = args)));
      });
      context.on('weberror', (webError) => {
        const { message, stack } = webError.error();
        seen.push({ kind: 'pageerror', text: stack ?? message });
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
      expect(unexpectedErrors(seen, allowances).map(describeError), 'errors the browser logged or threw during the test').toEqual([]);
    },
    { auto: true },
  ],
});

/** What the page passed to `console.error`, as text: an Error by its name and message, anything else as JSON. A handle the page already closed reads as nothing. */
async function serialiseArgs(args: readonly JSHandle[]): Promise<string> {
  const values = await Promise.all(
    args.map((arg) =>
      arg.jsonValue().then(
        (value: unknown) => (value instanceof Error ? `${value.name}: ${value.message}` : JSON.stringify(value)),
        () => '',
      ),
    ),
  );
  return values.join(' ');
}

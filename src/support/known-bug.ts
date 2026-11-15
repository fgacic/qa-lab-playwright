import { test } from '@playwright/test';

/**
 * Pins a known defect of the site under test. The spec states the behaviour the site *should*
 * have; `test.fail` makes today's failure expected, so the suite stays green, and the test turns
 * red ("expected to fail, but passed") the day the site is fixed.
 *
 * Contract: the pin asserts the desired behaviour, and the bug assertion's message starts with
 * the id (`expect(locator, 'BUG-26: the form names the missing fields')`). Everything before it is
 * a precondition that holds whether or not the bug is fixed and never names the id. `test.fail`
 * alone accepts any failure, a fixture teardown error included, so the pin is only as good as
 * `VERIFY_BUGS=1` (scripts/verify-bugs.mjs), which runs these as ordinary tests and counts a pin as
 * reproducing only if it failed in the test body, with every error naming its id, assertion-shaped
 * and raised from the spec itself. A precondition, a locator, a timeout or a teardown failure is
 * reported as "fails for another reason", and a pass as fixed.
 */
export function knownBug(id: string, summary: string): void {
  // scripts/verify-bugs.mjs finds the pins by the @bug tag: a pin without it would never be verified.
  if (!test.info().tags.includes('@bug')) throw new Error(`knownBug(${id}) needs the @bug tag: add { tag: ['@bug'] } to the test, or verify-bugs.mjs never checks this pin.`);
  test.info().annotations.push({ type: 'known bug', description: `${id}: ${summary} (docs/COVERAGE.md)` });
  test.fail(process.env.VERIFY_BUGS !== '1', `${id}: ${summary}`);
}

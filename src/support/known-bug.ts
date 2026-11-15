import { test } from '@playwright/test';

/**
 * Pins a known defect of the site under test. The spec states the behaviour the site *should*
 * have; `test.fail` makes today's failure expected, so the suite stays green, and the test turns
 * red ("expected to fail, but passed") the day the site is fixed.
 *
 * Contract: the pin asserts the desired behaviour, and the bug assertion's message starts with
 * the id (`expect(locator, 'BUG-26: the form names the missing fields')`). `VERIFY_BUGS=1`
 * (scripts/verify-bugs.mjs) runs these as ordinary tests and counts a pin as reproducing only
 * if it failed and its error message contains its id; a failure without the id (a precondition,
 * a locator, a timeout) is reported as "fails for another reason", and a pass as fixed.
 */
export function knownBug(id: string, summary: string): void {
  test.info().annotations.push({ type: 'known bug', description: `${id}: ${summary} (docs/COVERAGE.md)` });
  test.fail(process.env.VERIFY_BUGS !== '1', `${id}: ${summary}`);
}

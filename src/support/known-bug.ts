import { test } from '@playwright/test';

/**
 * Pins a known defect of the site under test. The spec states the behaviour the site *should*
 * have; `test.fail` makes today's failure expected, so the suite stays green, and the test turns
 * red ("expected to fail, but passed") the day the site is fixed.
 *
 * `VERIFY_BUGS=1` runs these as ordinary tests, to check that each one fails at its last
 * assertion (the bug) and not earlier for an unrelated reason.
 */
export function knownBug(id: string, summary: string): void {
  test.info().annotations.push({ type: 'known bug', description: `${id}: ${summary} (docs/COVERAGE.md)` });
  test.fail(process.env.VERIFY_BUGS !== '1', `${id}: ${summary}`);
}

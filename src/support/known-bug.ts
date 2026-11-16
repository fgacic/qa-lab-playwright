import { test } from '@playwright/test';

/**
 * How long a pin waits for the behaviour a fixed site would show (an error message, a disabled button, a redirect).
 * One value for every pin, so a slower runner is tuned in one place: the bug assertion fails after this window
 * on a site that still has the defect, so it is also what a passing (broken) pin costs.
 */
export const BUG_TIMEOUT = 5_000;

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
 * reported as "fails for another reason", and a pass as fixed. A bug assertion on a locator that
 * matches nothing also fails with the id in its message, so verify-bugs rejects that too, unless the
 * defect is itself an absence (a missing heading, an element never rendered): pass `{ absence: true }`.
 *
 * A pin must fail deterministically. `test.fail` makes a failure expected, so a pin that reproduces only when it wins a race
 * is green 99 times in 100 and a red gate on the 100th (BUG-46 did exactly that on WebKit). A pin whose defect depends on
 * timing (a double submit, a click racing a re-render, a debounce) therefore holds the outcome open instead of racing it:
 * mock the call and gate its response (`apiMock.delay(...)`, or a route that waits on a promise the test resolves after the
 * second action), then count the requests that reached the handler, as the BUG-53 pin does. verify-bugs.mjs backs this up: it
 * verifies a pin in every project that schedules it, and reruns a pin that passed, so a race that is lost once is reported
 * as flaky, not as a fix. (No `{ timing: true }` flag: it would only repeat what this rule and that rerun already enforce.)
 */
export function knownBug(id: string, summary: string, { absence = false }: { absence?: boolean } = {}): void {
  // scripts/verify-bugs.mjs finds the pins by the @bug tag: a pin without it would never be verified.
  if (!test.info().tags.includes('@bug')) throw new Error(`knownBug(${id}) needs the @bug tag: add { tag: ['@bug'] } to the test, or verify-bugs.mjs never checks this pin.`);
  test.info().annotations.push({ type: 'known bug', description: `${id}: ${summary} (docs/COVERAGE.md)` });
  // verify-bugs.mjs rejects a reproduction whose locator matched no element ("element(s) not found"): that is a
  // missing precondition, not a wrong value. A pin whose defect IS an absence declares it here, in the open.
  if (absence) test.info().annotations.push({ type: 'known bug absence', description: id });
  test.fail(process.env.VERIFY_BUGS !== '1', `${id}: ${summary}`);
}

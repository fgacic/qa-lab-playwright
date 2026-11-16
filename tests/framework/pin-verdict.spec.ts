// scripts/verify-bugs.mjs decides whether a pin still reproduces its bug. Its verdicts are pure (scripts/lib/pin-verdict.mjs),
// so every way a pin can fail "for another reason" is table-tested here instead of trusted.
import { expect, test } from '@playwright/test';
import { afterRerun, judge, matchedNoElement, mentions, strip, whyNotThePin, type PinResult } from '../../scripts/lib/pin-verdict.mjs';

const SPEC = 'tests/catalog/example.spec.ts';
const assertion = (id: string, extra = '') => `Error: ${id}: the grid is sorted\n\nexpect(received).toBe(expected)${extra}`;
const pin = (overrides: Partial<PinResult> = {}): PinResult => ({
  status: 'unexpected', last: 'failed', id: 'BUG-12', specFile: SPEC, errors: [{ message: assertion('BUG-12'), file: `/repo/${SPEC}` }], ...overrides,
});

test.describe('verify-bugs verdicts', { tag: ['@framework'] }, () => {
  test('an id is found as a whole word only', () => {
    expect(mentions('BUG-1: wrong', 'BUG-1')).toBe(true);
    expect(mentions('Error: BUG-1: wrong', 'BUG-1')).toBe(true);
    expect(mentions('BUG-12: wrong', 'BUG-1'), 'a longer id is not this id').toBe(false);
    expect(mentions('XBUG-1: wrong', 'BUG-1'), 'a prefix is not this id').toBe(false);
    expect(mentions('see BUG-1.', 'BUG-1'), 'punctuation ends the word').toBe(true);
    expect(mentions('A11Y-02: x', 'A11Y-02')).toBe(true);
    expect(mentions('BUG-1x', 'BUG-1')).toBe(false);
  });

  test('ANSI colour is stripped before a message is read', () => {
    expect(strip('\u001b[31mBUG-1\u001b[39m: red')).toBe('BUG-1: red');
    expect(strip(undefined)).toBe('');
  });

  test('a locator that matched nothing is told apart from one that matched a wrong value', () => {
    const none = 'expect(locator).toBeVisible()\n\nLocator: getByRole(...)\nExpected: visible\nReceived: <element(s) not found>';
    const waitedOnly = 'expect(locator).toBeVisible() failed\n\nCall log:\n  - waiting for getByRole(...)\n';
    const resolved = 'expect(locator).toHaveText(...)\n\nCall log:\n  - waiting for getByRole(...)\n  - locator resolved to <h1>Wrong</h1>\n';
    expect(matchedNoElement(none)).toBe(true);
    expect(matchedNoElement(waitedOnly)).toBe(true);
    expect(matchedNoElement(resolved)).toBe(false);
    expect(matchedNoElement('expect(received).toBe(expected)'), 'not a locator assertion').toBe(false);
  });

  test('whyNotThePin accepts the pinned failure and names every other way a pin can fail', () => {
    const refused: { name: string; result: PinResult; expected: RegExp }[] = [
      { name: 'a timeout', result: pin({ last: 'timedOut' }), expected: /timed out/ },
      { name: 'no error message at all', result: pin({ errors: [] }), expected: /no error message/ },
      { name: 'an error that does not name the id (a precondition)', result: pin({ errors: [{ message: 'expect(received).toBe(expected)', file: `/repo/${SPEC}` }] }), expected: /does not name "BUG-12"/ },
      { name: 'an error naming a longer id', result: pin({ errors: [{ message: assertion('BUG-123'), file: `/repo/${SPEC}` }] }), expected: /does not name "BUG-12"/ },
      { name: 'the id in a message that is not an assertion', result: pin({ errors: [{ message: 'Error: BUG-12: something threw', file: `/repo/${SPEC}` }] }), expected: /not an assertion failure/ },
      { name: 'a test timeout reported as an expect', result: pin({ errors: [{ message: `${assertion('BUG-12')}\nTest timeout of 45000ms exceeded`, file: `/repo/${SPEC}` }] }), expected: /not an assertion failure/ },
      { name: 'a closed page', result: pin({ errors: [{ message: `${assertion('BUG-12')}\nTarget page, context or browser has been closed`, file: `/repo/${SPEC}` }] }), expected: /not an assertion failure/ },
      {
        name: 'an element that was never found',
        result: pin({ errors: [{ message: `Error: BUG-12: x\nexpect(locator).toBeVisible()\nReceived: <element(s) not found>`, file: `/repo/${SPEC}` }] }),
        expected: /matched no element/,
      },
      { name: 'a teardown or fixture error', result: pin({ errors: [{ message: assertion('BUG-12'), file: '/repo/fixtures/mocks.ts' }] }), expected: /fixture or teardown/ },
      {
        name: 'a second error from the fixture teardown',
        result: pin({ errors: [{ message: assertion('BUG-12'), file: `/repo/${SPEC}` }, { message: assertion('BUG-12'), file: '/repo/fixtures/mocks.ts' }] }),
        expected: /error 2 came from fixtures\/mocks\.ts/,
      },
    ];
    const accepted: { name: string; result: PinResult }[] = [
      { name: 'a spec-raised assertion naming the id', result: pin() },
      {
        name: 'an element never found, but the pin is an absence',
        result: pin({ absence: true, errors: [{ message: `Error: BUG-12: x\nexpect(locator).toBeVisible()\nReceived: <element(s) not found>`, file: `/repo/${SPEC}` }] }),
      },
    ];
    for (const { name, result } of accepted) expect(whyNotThePin(result), name).toBeUndefined();
    for (const { name, result, expected } of refused) expect(whyNotThePin(result), name).toMatch(expected);
  });

  test('judge: a failure as pinned reproduces, a pass is fixed, skipped and flaky are not verified', () => {
    expect(judge(pin())).toEqual({ reproduces: true });
    expect(judge(pin({ last: 'passed', errors: [] }))).toEqual({ fixed: true });
    expect(judge(pin({ status: 'skipped', last: 'skipped' }))).toEqual({ notVerified: 'skipped' });
    expect(judge(pin({ status: 'flaky' }))).toEqual({ notVerified: expect.stringMatching(/flaky/) });
    expect(judge(pin({ id: undefined }))).toEqual({ other: expect.stringMatching(/no known-bug annotation/) });
    expect(judge(pin({ last: 'timedOut' }))).toEqual({ other: expect.stringMatching(/timed out/) });
  });

  test('afterRerun: a pin that failed for another reason is only trusted if the rerun agrees it is broken', () => {
    const first = { other: 'the test timed out' };
    expect(afterRerun(first, { reproduces: true }).notVerified, 'it reproduced the second time').toMatch(/then reproduced on a rerun.*flaky/);
    expect(afterRerun(first, { fixed: true }).notVerified, 'it passed the second time').toMatch(/then passed on a rerun.*flaky/);
    expect(afterRerun(first, { other: 'another problem' })).toEqual({ other: 'the test timed out (the same on a rerun)' });
    expect(afterRerun(first, undefined), 'the rerun produced no result').toEqual(first);
    expect(afterRerun(first, { notVerified: 'skipped' }), 'a rerun that was skipped keeps the first verdict').toEqual(first);
  });
});

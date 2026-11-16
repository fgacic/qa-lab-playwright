// The pure verdicts of scripts/verify-bugs.mjs, apart from the process spawning, so tests/framework/pin-verdict.spec.ts can
// table-test them. The contract they judge is in src/support/known-bug.ts.

// eslint-disable-next-line no-control-regex -- the escape character is what an ANSI colour sequence starts with
const ANSI = /\u001b\[[0-9;]*m/g;
export const strip = (text) => (text ?? '').replace(ANSI, '');

export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The id as a whole word: "BUG-1" must not be found in "BUG-12: ...". */
export const mentions = (message, id) => new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(id)}(?![A-Za-z0-9_-])`).test(message);

export function firstLine(message) {
  return message.split('\n').find((line) => line.trim()) ?? '';
}

/**
 * Whether a failed locator expectation never found its element. Playwright's message says so in two ways: the
 * received value is `<element(s) not found>`, or the call log shows it waiting for the locator and never
 * "resolved to" anything. (A count or a hidden element still resolves, so a bug about those is not caught here.)
 */
export function matchedNoElement(message) {
  if (!/expect\(locator\)/.test(message)) return false;
  if (/Received[^\n]*<element\(s\) not found>/.test(message)) return true;
  return /^\s*- waiting for /m.test(message) && !/resolved to/.test(message);
}

/** Why a failed pin is not the pinned bug, or undefined when it is. */
export function whyNotThePin({ id, errors, specFile, last, absence }) {
  if (last === 'timedOut') return 'the test timed out';
  if (!errors.length) return 'failed with no error message';
  for (const [i, { message, file }] of errors.entries()) {
    const where = i === 0 ? 'the test body' : `error ${i + 1}`;
    if (!mentions(message, id)) return `${where} does not name "${id}": ${firstLine(message)}`;
    if (!/expect\(/.test(message) || /Test timeout of|Target (page, context or browser|closed)|has been closed/.test(message)) {
      return `${where} names "${id}" but is not an assertion failure: ${firstLine(message)}`;
    }
    if (!absence && matchedNoElement(message)) return `${where} names "${id}" but its locator matched no element, which proves nothing about the bug: add a precondition that the element exists (or pin an absence with { absence: true })`;
    if (file && !file.endsWith(specFile)) return `${where} came from ${file.split('/').slice(-2).join('/')} (a fixture or teardown), not from the spec`;
  }
  return undefined;
}

/** The verdict for one run of a pin (scripts/verify-bugs.mjs reruns a pass or another failure before trusting it): `{ reproduces }`, `{ fixed }`, `{ notVerified }` or `{ other }` (a problem line). */
export function judge(r) {
  if (r.status === 'skipped' || r.last === 'skipped') return { notVerified: 'skipped' };
  if (r.status === 'flaky') return { notVerified: 'flaky (passed on a retry), so it cannot be trusted either way' };
  if (r.last === 'passed') return { fixed: true };
  if (!r.id) return { other: 'no known-bug annotation, so no id to look for' };
  const problem = whyNotThePin(r);
  return problem ? { other: problem } : { reproduces: true };
}

/**
 * The verdict after a pin was run once more, alone: `first` is the verdict of the run that was not trusted (`{ other }`, or
 * `{ fixed }` for a pin that passed), `second` the rerun's (undefined when it produced no result).
 * Both directions get the rerun: a slow moment must not fail the gate, and a lucky one must not read as a fix.
 */
export function afterRerun(first, second) {
  if (first.fixed) {
    if (second?.fixed) return first;
    if (second?.reproduces) return { notVerified: 'flaky: passed once, reproduced on rerun (a pin that depends on timing must hold the request open)' };
    if (second?.other) return { notVerified: `flaky: passed once, then failed for another reason on a rerun (${second.other})` };
    return first;
  }
  if (second?.reproduces) return { notVerified: `failed for another reason, then reproduced on a rerun (${first.other}): flaky` };
  if (second?.fixed) return { notVerified: `failed for another reason, then passed on a rerun (${first.other}): flaky` };
  if (second?.other) return { other: `${first.other} (the same on a rerun)` };
  return first;
}

import { API_URL } from './env';

/**
 * What counts as a browser error a test must not ignore: anything the page logs with `console.error` or throws
 * uncaught (`pageerror`), unless it is on this list. The list is short and each entry says why it is harmless.
 */
export interface Allowance {
  pattern: RegExp;
  reason: string;
}

export interface BrowserError {
  kind: 'console' | 'pageerror';
  text: string;
  /**
   * The arguments of a `console.error(...)` call as the page passed them, serialised. `text` is how the engine prints them,
   * and Chromium, Firefox and WebKit print an object differently (`{message: Unauthorized}` against `JSHandle@object`), so a
   * pattern that must hold in every engine reads the arguments.
   */
  args?: string;
  /** The URL the browser reports for the message: the failing resource for a "Failed to load resource". */
  url?: string;
}

/**
 * Suite-wide allowances: noise that is not the shop's own fault and that no test could act on.
 * Everything else a page logs fails the test that caused it. A test that provokes an error on purpose (a mocked failure the
 * app logs) declares it with `consoleGuard.allow(pattern, reason)`, so the allowance is recorded next to the test.
 */
export const THIRD_PARTY_NOISE: readonly Allowance[] = [];

/**
 * The shop answering a request with an error the suite expects, and its SPA logging that answer with `console.error`. These are
 * the application's own bookkeeping of an HTTP status, not a defect: the status itself is asserted wherever it matters.
 */
export const EXPECTED_ANSWER_LOGS: readonly Allowance[] = [
  {
    pattern: /\bmessage"?: ?"?Unauthorized\b/,
    reason: 'every anonymous page load asks GET /users/me, gets the 401 it should, and the SPA logs the refusal as an error',
  },
  {
    pattern: /"status":404,[^\n]*"url":"[^"]*\/products\/[^"]+"/,
    reason: 'a product id the shop does not know: the SPA logs the 404 (an HttpErrorResponse) it got, handled, and draws the page without a product',
  },
  {
    pattern: /"status":500,[^\n]*"url":"[^"]*\/products\/[^"]+\/related"[^\n]*"message":"Product with ID /,
    reason: 'the related products of that unknown id: the shop answers 500 "Product with ID … not found" (the same missing product), and the SPA logs it, handled',
  },
  {
    pattern: /^ERROR XMLHttpRequestProgressEvent$/,
    reason: 'WebKit only: a request still in flight when the SPA moves on (signing in, then landing on the account area) is cancelled, and the SPA logs the cancelled XHR (a bare progress event, no status) as an error; nothing of the shop fails, and the page the test judges is the one it landed on',
  },
];

/**
 * Errors the shop really throws and that have a pin of their own, which is where each is proven (a test that waits for the
 * error and fails while it is raised). A test that judges something else (a scan, a translation visit, a screenshot) must not
 * fail on a defect another test already owns; when the defect is fixed the pin reports it and the line goes from here.
 */
export const PINNED_DEFECT_LOGS: readonly (Allowance & { id: string })[] = [
  {
    id: 'BUG-37',
    pattern: /angularx-qrcode.*Field `qrdata` is empty/,
    reason: 'the profile page draws its two-factor QR code from an empty secret before the setup answers, and logs it every time',
  },
  {
    id: 'BUG-38',
    pattern: /TypeError:.*\bcart_items\b/s,
    reason: 'the checkout reads cart_items of a cart that is not there yet (or no longer) while it moves between steps and after the order; the page still renders',
  },
  {
    id: 'SEC-13',
    pattern: /TypeError: (?:Cannot read properties of undefined \(reading 'name'\)|undefined is not an object \(evaluating 'this\.categories\[0\]\.name'\)|.*this\.categories\[0\].* is undefined)/,
    reason: 'the category page reads the name of a category that has not arrived (or does not exist) and throws; the page is drawn once it has arrived',
  },
  {
    id: 'BUG-02',
    pattern: /NG04002/,
    reason: 'the router has no route for an unknown path and logs it before redirecting home',
  },
  {
    id: 'BUG-47',
    pattern: /TypeError: (?:Cannot read properties of undefined \(reading 'value'\)|undefined is not an object \(evaluating '[\w.$]*\.value'\)|can't access property "value", [\w.$]+ is undefined)/,
    reason: 'the profile page reads `.value` of something that is not there each time its change-password request is answered, whatever the answer; the page still shows the answer',
  },
  {
    id: 'ADM-21',
    pattern: /NG01002|Must supply a value for form control/,
    reason: 'after the API accepts a new user the SPA throws an unhandled Angular error although the form says "User saved!"',
  },
];

/** Everything allowed in every test. */
export const SUITE_WIDE_ALLOWANCES: readonly Allowance[] = [...THIRD_PARTY_NOISE, ...EXPECTED_ANSWER_LOGS, ...PINNED_DEFECT_LOGS];

/**
 * "Failed to load resource: the server responded with a status of 500" is the browser's own line for any failed request.
 * For the shop's API it is the mirror of a response the suite already controls (a mock) or asserts (a status), so it
 * adds nothing; for any other resource (an image, a script, a font) it is a broken asset and does fail the test.
 */
const RESOURCE_FAILURE = /^Failed to load resource/;

export function isApiResourceFailure(error: BrowserError): boolean {
  return error.kind === 'console' && RESOURCE_FAILURE.test(error.text) && !!error.url && (error.url === API_URL || error.url.startsWith(`${API_URL}/`));
}

/** The errors no allowance covers, in the order they happened. */
export function unexpectedErrors(errors: readonly BrowserError[], allowances: readonly Allowance[]): BrowserError[] {
  return errors.filter((error) => !isApiResourceFailure(error) && !allowances.some(({ pattern }) => pattern.test(error.text) || (error.args !== undefined && pattern.test(error.args))));
}

/** One line per error, for the failure message. */
export function describeError(error: BrowserError): string {
  const first = error.text.split('\n').find((line) => line.trim()) ?? error.text;
  return `[${error.kind}] ${first.slice(0, 300)}${error.url ? ` (${error.url})` : ''}`;
}

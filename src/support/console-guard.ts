import type { JSHandle } from '@playwright/test';
import { apiPath, isApiUrl } from './env';

/**
 * What counts as a browser error a test must not ignore: anything the page logs with `console.error` or throws
 * uncaught (`pageerror`), unless it is on this list. The list is short and each entry says why it is harmless.
 */
export interface Allowance {
  pattern: RegExp;
  reason: string;
  /** The error is allowed only while the page that logged it is on a path this matches (a defect belongs to one screen, not to the whole site). */
  route?: RegExp;
  /** The error is allowed only when the browser reports this URL for it (the failing resource of a "Failed to load resource"). */
  url?: RegExp;
  /**
   * The error is allowed only in a test in which the browser received at least one answer of the shop that this matches: a log that
   * is only the echo of a request (the 401 of `GET /users/me`) means nothing without that request. It is not one log per answer:
   * the SPA shares one request between several subscribers and each logs the refusal, so WebKit receives 4 such 401s and the SPA
   * logs 6 times. The answer is read from the response the browser received, not from a console line of its own, because Chromium
   * logs a "Failed to load resource" for a 401 and Firefox and WebKit do not.
   */
  requiresAnswer?: (answer: ApiAnswer) => boolean;
  /**
   * The error is allowed only in a test in which a request of the shop really failed: the browser received an API answer with a
   * status of 400 or more (a real one or a mocked one, which the browser receives like any other), or a mock of the test aborted
   * a request (`MockAnswer`). The log the SPA writes for a failed request mirrors that failure, so without one it is a different error.
   */
  requiresFailure?: boolean;
  /** The error is allowed only in this engine (`browserName`): a log one engine writes for something another engine does not log at all. */
  browser?: 'chromium' | 'firefox' | 'webkit';
}

/**
 * A refusal a test expects of the shop and opts into (`consoleGuard.allowStatus`): the browser logs every 4xx answer as a "Failed to
 * load resource", and only a test that sends the input the shop refuses (or asks for the id it does not know) expects that line.
 */
export interface ExpectedStatus {
  status: number;
  /** The API path (`apiPath`) the status is expected for, as a RegExp or the exact path. */
  path: RegExp | string;
  reason: string;
}

/** One response of the shop's API the browser received, in any engine (`context.on('response')`). */
export interface ApiAnswer {
  method: string;
  pathname: string;
  status: number;
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
  /** The path of the page that logged or threw it, when the browser said which page. */
  route?: string;
}

/** What the mock layer answered with, for `isApiResourceFailure`: the API path and either the HTTP status or `'aborted'`. */
export interface MockAnswer {
  pathname: string;
  outcome: number | 'aborted';
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
    // Only as the echo of that very request: no "Unauthorized" log without a 401 of GET /users/me.
    requiresAnswer: (answer) => answer.method === 'GET' && answer.pathname === '/users/me' && answer.status === 401,
  },
  {
    pattern: /"status":404,[^\n]*"url":"[^"]*\/products\/[^"]+"/,
    route: /^\/product\//,
    reason: 'a product id the shop does not know: the SPA logs the 404 (an HttpErrorResponse) it got, handled, and draws the page without a product',
  },
  {
    pattern: /"status":500,[^\n]*"url":"[^"]*\/products\/[^"]+\/related"[^\n]*"message":"Product with ID /,
    route: /^\/product\//,
    reason: 'the related products of that unknown id: the shop answers 500 "Product with ID … not found" (the same missing product), and the SPA logs it, handled',
  },
  {
    pattern: /^Failed to load resource: the server responded with a status of 500\b/,
    url: /\/products\/[^/]+\/related$/,
    route: /^\/product\//,
    reason: 'the browser\'s own line for the 500 the shop answers for the related products of a product id it does not know (the same missing product as the 404 above); the SPA handles it and draws the page without a product',
  },
  {
    pattern: /^ERROR XMLHttpRequestProgressEvent$/,
    browser: 'webkit',
    reason: 'a request still in flight when the SPA moves on (signing in, then landing on the account area) is cancelled, and the SPA logs the cancelled XHR (a bare progress event, no status) as an error; nothing of the shop fails, and the page the test judges is the one it landed on',
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
    route: /^\/account\/profile$/,
    reason: 'the profile page draws its two-factor QR code from an empty secret before the setup answers, and logs it every time',
  },
  {
    id: 'BUG-38',
    pattern: /TypeError:.*\bcart_items\b/s,
    route: /^\/checkout$/,
    reason: 'the checkout reads cart_items of a cart that is not there yet (or no longer) while it moves between steps and after the order; the page still renders',
  },
  {
    id: 'SEC-13',
    pattern: /TypeError: (?:Cannot read properties of undefined \(reading 'name'\)|undefined is not an object \(evaluating 'this\.categories\[0\]\.name'\)|.*this\.categories\[0\].* is undefined)/,
    route: /^\/category\//,
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
    route: /^\/account\/profile$/,
    reason: 'the profile page reads `.value` of something that is not there each time its change-password request is answered, whatever the answer; the page still shows the answer',
  },
  {
    id: 'BUG-54',
    pattern: /^Failed to load resource: the server responded with a status of 500\b/,
    url: /\/users\/refresh$/,
    route: /^\/(?:account(?:\/|$)|auth\/login$)/,
    reason: 'a signed-out visit of a protected page asks GET /users/refresh with no token and gets an unhandled JWTException (500) instead of 401, then goes to the login page',
  },
  {
    id: 'ADM-21',
    pattern: /NG01002|Must supply a value for form control/,
    route: /^\/admin\/users(?:\/|$)/,
    reason: 'after the API accepts a new user the SPA throws an unhandled Angular error although the form says "User saved!"',
  },
];

/** Everything allowed in every test (whatever the engine: `allowancesFor` narrows it to one). */
export const SUITE_WIDE_ALLOWANCES: readonly Allowance[] = [...THIRD_PARTY_NOISE, ...EXPECTED_ANSWER_LOGS, ...PINNED_DEFECT_LOGS];

/** The suite-wide allowances that apply in `browserName`: the ones with no engine of their own, and the ones of that engine. */
export const allowancesFor = (browserName: string): Allowance[] => SUITE_WIDE_ALLOWANCES.filter((allowance) => allowance.browser === undefined || allowance.browser === browserName);

/**
 * "Failed to load resource: the server responded with a status of 500" is the browser's own line for any failed request. It is
 * the mirror of an answer the suite already controls or asserts, so it adds nothing, only in these two cases:
 * - the shop answered that path with a status expected of it: the 401 of an anonymous `GET /users/me` in every test (`EXPECTED_API_STATUSES`),
 *   and the 404 of an id it does not know or the 422 and 409 with which it refuses invalid or conflicting input only in a test that
 *   opted in for that status and path (`ExpectedStatus`, `consoleGuard.allowStatus`), so a page that starts calling a removed endpoint
 *   fails every other test. A response of that status for that path must have been received (`answered`), so a console line alone,
 *   with no such answer behind it, is not enough, or
 * - the request is one a mock of this test answered (with that status, or by aborting it): the test chose that failure.
 * Anything else (a real 5xx, a refused connection, a broken image, script or font) is a defect and fails the test.
 */
const RESOURCE_FAILURE = /^Failed to load resource/;
const STATUS_OF = /status of (\d{3})/;
export const EXPECTED_API_STATUSES: readonly number[] = [401];

export function isApiResourceFailure(
  error: BrowserError,
  mocked: readonly MockAnswer[] = [],
  answered: readonly ApiAnswer[] = [],
  expected: readonly ExpectedStatus[] = [],
): boolean {
  if (error.kind !== 'console' || !RESOURCE_FAILURE.test(error.text) || !error.url || !isApiUrl(error.url)) return false;
  const status = Number(STATUS_OF.exec(error.text)?.[1]);
  const pathname = apiPath(error.url);
  const wasAnswered = answered.some((answer) => answer.pathname === pathname && answer.status === status);
  const optedIn = expected.some((entry) => entry.status === status && (typeof entry.path === 'string' ? entry.path === pathname : entry.path.test(pathname)));
  if ((EXPECTED_API_STATUSES.includes(status) || optedIn) && wasAnswered) return true;
  return mocked.some((answer) => answer.pathname === pathname && (answer.outcome === 'aborted' ? /net::ERR_/.test(error.text) : answer.outcome === status));
}

/** Whether a request of the shop failed in this test: an API answer of 400 or more, or a request a mock aborted. */
export function requestFailed(mocked: readonly MockAnswer[], answered: readonly ApiAnswer[]): boolean {
  return answered.some((answer) => answer.status >= 400) || mocked.some((answer) => answer.outcome === 'aborted' || answer.outcome >= 400);
}

/**
 * The errors no allowance covers, in the order they happened. `mocked` is what the test's mocks answered (`ApiMock.answers`);
 * `answered` is every API response the browser received, which an allowance with `requiresAnswer` looks for; `expected` is what the
 * test opted into with `allowStatus`.
 */
export function unexpectedErrors(
  errors: readonly BrowserError[],
  allowances: readonly Allowance[],
  mocked: readonly MockAnswer[] = [],
  answered: readonly ApiAnswer[] = [],
  expected: readonly ExpectedStatus[] = [],
): BrowserError[] {
  return errors.filter((error) => {
    if (isApiResourceFailure(error, mocked, answered, expected)) return false;
    const covered = allowances.some((allowance) => {
      if (!(allowance.pattern.test(error.text) || (error.args !== undefined && allowance.pattern.test(error.args)))) return false;
      if (allowance.route && !(error.route !== undefined && allowance.route.test(error.route))) return false;
      if (allowance.url && !(error.url !== undefined && allowance.url.test(error.url))) return false;
      if (allowance.requiresFailure && !requestFailed(mocked, answered)) return false;
      return allowance.requiresAnswer === undefined || answered.some(allowance.requiresAnswer);
    });
    return !covered;
  });
}

/** One line per error, for the failure message. */
export function describeError(error: BrowserError): string {
  const first = error.text.split('\n').find((line) => line.trim()) ?? error.text;
  return `[${error.kind}] ${first.slice(0, 300)}${error.url ? ` (${error.url})` : ''}`;
}

/**
 * What the page passed to `console.error`, as text: an Error by its name and message, anything else as JSON. The named helper for
 * a spec that must read the arguments of a console message (it may not call `evaluate` on a handle itself, see eslint.config.mjs).
 * A handle the page already closed (a navigation, a closed page) reads as nothing instead of rejecting.
 */
export async function consoleArgsText(args: readonly JSHandle[]): Promise<string> {
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

import type { Page, Request, Response, Route } from '@playwright/test';
import { IS_SELF_HOSTED, apiPath, isApiUrl } from './env';
import type { MockAnswer } from './console-guard';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'QUERY';
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Writes the guard lets through even on the live site: an anonymous cart is how the live run arranges
 * its read flows (src/support/toolshop-api.ts) and edits no account, order or message. Everything else
 * that no mock answers is refused there.
 */
const ANONYMOUS_CART_WRITES: { method: HttpMethod; path: RegExp }[] = [
  { method: 'POST', path: /^\/carts$/ },
  { method: 'POST', path: /^\/carts\/[^/]+$/ },
  { method: 'PUT', path: /^\/carts\/[^/]+\/product\/quantity$/ },
  { method: 'DELETE', path: /^\/carts\/[^/]+\/product\/[^/]+$/ },
];

/** Whether the write guard lets a request through unmocked even on a target that is not self-hosted: the anonymous cart calls only. */
export function isAllowedAnonymousWrite(method: string, pathname: string): boolean {
  return ANONYMOUS_CART_WRITES.some((w) => w.method === method && w.path.test(pathname));
}

/** Whether `method` changes something on the server, so the write guard has a say. */
export function isWrite(method: string): boolean {
  return WRITES.has(method);
}

/** A position in the stream of requests a page has sent: `ApiMock.mark()`, `expectNoRequest(..., { since })`. */
export type RequestMark = number & { readonly __requestMark: unique symbol };

/** Options of `waitForRequest` / `waitForResponse`: give up after `timeout` ms (Playwright's own 30 s when unset). */
export interface WaitOptions {
  timeout?: number;
}

/**
 * One mocked endpoint. `path` is the API path without the host: a string matches exactly,
 * a RegExp matches the path (both relative to API_URL). Responses are served in order; the last one repeats.
 */
export interface MockRoute {
  method: HttpMethod;
  path: string | RegExp;
  responses: MockResponse[];
}

/** Delays the requests of one endpoint whose JSON body satisfies `when`: `ApiMock.delay`. */
interface DelayRule {
  method: HttpMethod;
  path: MockRoute['path'];
  when: (body: Record<string, unknown>) => boolean;
  ms: number;
}

/** An endpoint whose real answers are delivered in the order they were asked for: `ApiMock.serialize`. */
interface SerialRule {
  method: HttpMethod;
  path: MockRoute['path'];
  /** Settles when the answer of the latest request has been delivered (or has failed). */
  tail: Promise<void>;
}

export type MockResponse =
  | { status: number; json?: unknown; body?: string; contentType?: string }
  | { abort: 'failed' | 'timedout' | 'connectionrefused' };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,QUERY,OPTIONS',
};

/**
 * The `apiMocks` option. It is an object rather than a bare array on purpose: `test.use()`
 * reads a two-element array as a `[value, options]` fixture tuple and would drop the second mock.
 */
export interface MockSet {
  routes: MockRoute[];
}

/** `test.use(withMocks(mock.fail('GET', '/brands'), mock.fail('GET', '/categories/tree')))` */
export const withMocks = (...routes: MockRoute[]): { apiMocks: MockSet } => ({ apiMocks: { routes } });

/** Declarative builders, so a spec reads `mock.fail('QUERY', '/products', 500)`. */
export const mock = {
  respond: (method: HttpMethod, path: MockRoute['path'], json: unknown, status = 200): MockRoute => ({
    method, path, responses: [{ status, json }],
  }),
  fail: (method: HttpMethod, path: MockRoute['path'], status = 500, json: unknown = { message: 'Server Error' }): MockRoute => ({
    method, path, responses: [{ status, json }],
  }),
  abort: (method: HttpMethod, path: MockRoute['path']): MockRoute => ({
    method, path, responses: [{ abort: 'failed' }],
  }),
  sequence: (method: HttpMethod, path: MockRoute['path'], ...responses: MockResponse[]): MockRoute => ({
    method, path, responses,
  }),
  eventStream: (path: MockRoute['path'], body: string): MockRoute => ({
    method: 'GET', path, responses: [{ status: 200, body, contentType: 'text/event-stream' }],
  }),
};

/**
 * Routes requests to the Toolshop API through mocks. Unmatched requests go to the real API.
 * Mocking is per browser context (the test's own), so it covers every page the test opens and never leaks between tests.
 *
 * On a target that is not self-hosted the write guard is on from the start (`guardWrites`): a gap in
 * the mocks must never write to the public shop. Only the anonymous cart writes above pass.
 */
export class ApiMock {
  private readonly routes: MockRoute[] = [];
  private readonly defaults: MockRoute[] = [];
  private installed = false;
  /** How many answers each route has served in this page. The routes themselves stay untouched, so a describe-level sequence replays from the start in every test. */
  private readonly served = new WeakMap<MockRoute, number>();
  private readonly delays: DelayRule[] = [];
  private readonly serials: SerialRule[] = [];
  private guardWrites: boolean;
  /** Writes the guard refused (see `blockUnmockedWrites`). */
  readonly blockedWrites: string[] = [];
  /** Failures of the mock layer's own code (a `when` predicate that threw), which the test must not ignore: the `page` fixture asserts there are none. */
  readonly handlerErrors: string[] = [];
  /** What the mocks of this test answered (a status, or an abort), so the console guard can tell a failure the test chose from one the shop raised. */
  readonly answers: MockAnswer[] = [];
  /** Every API request the page has sent since this mock was created, mocked or real, for `requestsTo`. */
  private readonly sent: { method: string; pathname: string }[] = [];

  /**
   * `latencyMs` delays every API request, mocked or real, as a slow network would.
   * `guardWrites` defaults to on wherever the target is not self-hosted.
   */
  constructor(private readonly page: Page, private readonly latencyMs = 0, guardWrites = !IS_SELF_HOSTED) {
    this.guardWrites = guardWrites;
    // On the context, like the route: a page opened with `context.newPage()` is observed and guarded too.
    page.context().on('request', (request) => {
      if (isApiUrl(request.url())) this.sent.push({ method: request.method(), pathname: apiPath(request.url()) });
    });
  }

  /** Whether `install()` has work to do even with no mocks: a latency or a write guard. */
  get needsRoute(): boolean {
    return this.latencyMs > 0 || this.guardWrites;
  }

  /** Routes the API through the mock layer even with no mocks, e.g. to apply the latency. */
  async install(): Promise<void> {
    if (this.installed) return;
    this.installed = true;
    await this.page.context().route((url) => isApiUrl(url.href), (route) => this.handle(route));
  }

  async use(...routes: MockRoute[]): Promise<void> {
    // Later registrations win, so a test can override a describe-level mock.
    this.routes.unshift(...routes);
    await this.install();
  }

  /** Fallback answers that any `use()` or describe-level mock overrides, e.g. a mocked back office. */
  async useDefaults(...routes: MockRoute[]): Promise<void> {
    // Pushed, where `use` unshifts: the FIRST default registered wins among defaults (a later one does not override an earlier one), and every `use` beats all of them.
    this.defaults.push(...routes);
    await this.install();
  }

  /**
   * Refuses (HTTP 418) every POST/PUT/PATCH/DELETE to the API that no mock answers. The mocked
   * admin specs turn this on so a gap in the mocks can never write to the real shared backend; on a
   * target that is not self-hosted it is already on (see the class comment).
   */
  async blockUnmockedWrites(): Promise<void> {
    this.guardWrites = true;
    await this.install();
  }

  /**
   * Holds back every request of an endpoint whose JSON body satisfies `when` by `ms`, then lets it
   * through (to a mock if one answers it, else to the real API). It is how a spec makes a slow answer
   * for an earlier request, the other half of a race, without a route of its own beside the mock layer.
   */
  async delay(method: HttpMethod, path: MockRoute['path'], when: (body: Record<string, unknown>) => boolean, ms: number): Promise<void> {
    assertPath(path);
    this.delays.push({ method, path, when, ms });
    await this.install();
  }

  /**
   * Delivers the REAL answers of an endpoint in the order the requests were sent, whatever order the
   * server finishes them in: each answer waits until the previous one has been delivered. For specs
   * that are not about a race the app loses (the answers of one slider drag, say) and need the last
   * request's answer to be the last one the page sees. A mocked answer is not held: it is already deterministic.
   */
  async serialize(method: HttpMethod, path: MockRoute['path']): Promise<void> {
    assertPath(path);
    this.serials.push({ method, path, tail: Promise.resolve() });
    await this.install();
  }

  /**
   * A position in the page's requests, taken right before the action under test. `expectNoRequest(..., { since: mark })`
   * and `requestsTo(..., { since: mark })` then count only what the action caused, not the page's own load.
   *
   * Async on purpose: a request the page has just sent reaches this mock as a protocol event, and the event can still
   * be in flight when the page's own code has moved on. One round trip to the browser (a call whose answer is queued
   * behind every event sent before it) drains them, so the position is taken after the page's earlier requests are counted,
   * not before: a request sent before the mark can never be counted as the action's.
   */
  async mark(): Promise<RequestMark> {
    await this.page.context().cookies();
    return this.sent.length as RequestMark;
  }

  /**
   * How many requests to an endpoint the page has sent since this mock was created (or since `since`), mocked or
   * real. A snapshot, so it proves that something WAS sent (`expect.poll(...).toBeGreaterThan(0)`),
   * never that something was not: use `expectNoRequest` for that.
   */
  requestsTo(method: HttpMethod, path: MockRoute['path'], { since = 0 as RequestMark }: { since?: RequestMark } = {}): number {
    return this.sent.slice(since).filter((r) => r.method === method && matches(path, r.pathname)).length;
  }

  /**
   * Proves that no request to an endpoint is sent: it fails on the first one, whether it was sent
   * before the call or arrives within `within` ms. Call it AFTER the action that could send the request.
   *
   * A window is needed because an absence cannot be observed, only waited for: a one-shot count
   * (`requestsTo(...) === 0`) passes the instant it is taken, before a handler that fires on a later
   * tick, a debounce or a promise has sent anything. The default 750 ms covers the debounce and
   * submit handlers in this app (the slowest is the 300 ms search debounce); pass a longer window for
   * a slower trigger. The cost is exactly `within` on a passing test, which is why a spec should call
   * this once, at the end of the scenario, not between steps.
   *
   * Without `since` every request since the mock was created counts, the page's own load included: a negative about
   * an action takes `const before = await apiMock.mark()` first and passes `{ since: before }`.
   */
  async expectNoRequest(method: HttpMethod, path: MockRoute['path'], { within = 750, since = 0 as RequestMark }: { within?: number; since?: RequestMark } = {}): Promise<void> {
    // Up front: a /g regex would otherwise throw from inside the listener, as an unhandled error, instead of from this call.
    assertPath(path);
    const label = (pathname: string) => `${method} ${pathname}`;
    const early = this.sent.slice(since).find((r) => r.method === method && matches(path, r.pathname));
    if (early) throw new Error(`Expected no ${label(early.pathname)}, but one was already sent`);
    const context = this.page.context();
    let onRequest!: (request: Request) => void;
    const arrived = new Promise<string>((resolve) => {
      onRequest = (request) => {
        if (request.method() === method && isApiUrl(request.url()) && matches(path, apiPath(request.url()))) resolve(apiPath(request.url()));
      };
      context.on('request', onRequest);
    });
    let stop!: () => void;
    const quiet = new Promise<undefined>((resolve) => {
      const timer = setTimeout(resolve, within);
      stop = () => clearTimeout(timer);
    });
    try {
      const pathname = await Promise.race([arrived, quiet]);
      if (pathname !== undefined) throw new Error(`Expected no ${label(pathname)} within ${within} ms, but one was sent`);
    } finally {
      stop();
      context.off('request', onRequest);
    }
  }

  /** Waits for the next request to an endpoint, mocked or real, and returns it. */
  waitForRequest(method: HttpMethod, path: MockRoute['path'], options: WaitOptions = {}): Promise<Request> {
    assertPath(path);
    const request = this.page.waitForRequest((r) => r.method() === method && isApiUrl(r.url()) && matches(path, apiPath(r.url())), options);
    // Observed from the start: if the action throws before the test awaits it, a timeout is not left as an unhandled rejection. Awaiting it still rejects.
    request.catch(() => undefined);
    return request;
  }

  /**
   * Waits for the next response from an endpoint, optionally only for a request whose JSON
   * body matches (the product list is one endpoint for every filter, sort and page).
   */
  async waitForResponse<T = unknown>(
    method: HttpMethod,
    path: MockRoute['path'],
    bodyMatches: (body: Record<string, unknown>) => boolean = () => true,
    options: WaitOptions = {},
  ): Promise<{ response: Response; body: Record<string, unknown>; json: T }> {
    assertPath(path);
    let body: Record<string, unknown> = {};
    const response = await this.page.waitForResponse((r) => {
      const request = r.request();
      if (request.method() !== method || !isApiUrl(r.url()) || !matches(path, apiPath(r.url()))) return false;
      body = jsonBody(request);
      return bodyMatches(body);
    }, options);
    // A mocked error may answer with no JSON body: hand that back as undefined instead of throwing.
    const json = (await response.json().catch(() => undefined)) as T;
    return { response, body, json };
  }

  /** Whether a delay rule applies to this request. A `when` that throws is a broken spec: it is recorded (the `page` fixture fails the test) and the request is not delayed. */
  private holds(rule: DelayRule, request: Request): boolean {
    try {
      return rule.when(jsonBody(request));
    } catch (error) {
      this.handlerErrors.push(`the "when" of delay(${rule.method} ${rule.path}) threw: ${(error as Error).message}`);
      return false;
    }
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const method = request.method();
    const pathname = apiPath(request.url());
    const all = [...this.routes, ...this.defaults];
    // A CORS preflight is answered only for a path some mock serves; otherwise the real API answers it,
    // so a missing CORS header on an unmocked endpoint still shows up.
    if (method === 'OPTIONS') {
      return all.some((r) => matches(r.path, pathname)) ? route.fulfill({ status: 204, headers: CORS }) : route.fallback();
    }
    const match = all.find((r) => r.method === method && matches(r.path, pathname));
    // The answer this request gets is fixed now, when it arrives, not after a delay: the order is the order of asking,
    // for a sequence of answers as well as for the real answers of a serialised endpoint.
    const index = match ? (this.served.get(match) ?? 0) : 0;
    if (match) this.served.set(match, index + 1);
    const serial = match ? undefined : this.serials.find((r) => r.method === method && matches(r.path, pathname));
    const turn = serial && takeTurn(serial);
    try {
      if (this.latencyMs) await sleep(this.latencyMs);
      for (const { ms } of this.delays.filter((d) => d.method === method && matches(d.path, pathname) && this.holds(d, request))) await sleep(ms);
      if (!match) {
        if (this.guardWrites && isWrite(method) && !isAllowedAnonymousWrite(method, pathname)) {
          this.blockedWrites.push(`${method} ${pathname}`);
          return await route.fulfill({ status: 418, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"Blocked by qa-lab: unmocked write"}' });
        }
        if (!turn) return await route.fallback();
        // Fetched at once, delivered when every earlier answer of the endpoint has been. A fetch that fails (the
        // page closed, the network dropped) fails this request, as it would have unrouted.
        const fetched = route.fetch();
        fetched.catch(() => undefined); // awaited only after the earlier turns: a rejection before that must not be unhandled
        await turn.earlier;
        // Only a page that went away mid-answer is tolerated (the request is aborted, as it would have been unrouted);
        // any other failure to deliver the answer is a bug in the mock layer and must surface.
        return await route.fulfill({ response: await fetched }).catch(async (error: unknown) => {
          if (!isClosedPage(error)) throw error;
          await route.abort('failed').catch(() => undefined);
        });
      }
      const response = match.responses[Math.min(index, match.responses.length - 1)];
      if ('abort' in response) {
        this.answers.push({ pathname, outcome: 'aborted' });
        return await route.abort(response.abort);
      }
      this.answers.push({ pathname, outcome: response.status });
      return await route.fulfill({
        status: response.status,
        headers: { ...CORS, 'content-type': response.contentType ?? 'application/json' },
        body: response.body ?? (response.json === undefined ? '' : JSON.stringify(response.json)),
      });
    } finally {
      turn?.done();
    }
  }
}

/** An error Playwright raises when the page, context or browser is gone, or the route was already settled by that. */
function isClosedPage(error: unknown): boolean {
  return /has been closed|Target (?:page|closed)|Route is already handled|Browser closed/i.test(String((error as Error)?.message ?? error));
}

/** Takes the next place in an endpoint's order: `earlier` settles when everyone ahead is done, `done` frees the place. */
function takeTurn(serial: SerialRule): { earlier: Promise<void>; done: () => void } {
  const earlier = serial.tail;
  let done!: () => void;
  serial.tail = new Promise<void>((resolve) => { done = resolve; });
  return { earlier, done };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A path pattern a mock can use: throws for a stateful (/g, /y) regex, which would match every other call only. */
function assertPath(path: MockRoute['path']): void {
  if (typeof path !== 'string' && (path.global || path.sticky)) {
    throw new Error(`Mock path ${path} must not use the /g or /y flag: it is stateful across test() calls`);
  }
}

/** The JSON body of a request, `{}` when it has none or is not JSON: a predicate must never throw. */
function jsonBody(request: Request): Record<string, unknown> {
  try {
    const body = request.postDataJSON();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function matches(path: MockRoute['path'], pathname: string): boolean {
  if (typeof path === 'string') return pathname === path;
  // A /g or /y regex keeps `lastIndex` between calls, so the same path would match every other time.
  assertPath(path);
  return path.test(pathname);
}

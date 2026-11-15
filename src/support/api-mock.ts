import type { Page, Request, Response, Route } from '@playwright/test';
import { API_URL, IS_SELF_HOSTED, apiPath } from './env';

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
 * Mocking is per page, so it never leaks between tests.
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
  private guardWrites: boolean;
  /** Writes the guard refused (see `blockUnmockedWrites`). */
  readonly blockedWrites: string[] = [];
  /** Every API request the page has sent since this mock was created, mocked or real, for `requestsTo`. */
  private readonly sent: { method: string; pathname: string }[] = [];

  /**
   * `latencyMs` delays every API request, mocked or real, as a slow network would.
   * `guardWrites` defaults to on wherever the target is not self-hosted.
   */
  constructor(private readonly page: Page, private readonly latencyMs = 0, guardWrites = !IS_SELF_HOSTED) {
    this.guardWrites = guardWrites;
    page.on('request', (request) => {
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
    await this.page.route((url) => isApiUrl(url.href), (route) => this.handle(route));
  }

  async use(...routes: MockRoute[]): Promise<void> {
    // Later registrations win, so a test can override a describe-level mock.
    this.routes.unshift(...routes);
    await this.install();
  }

  /** Fallback answers that any `use()` or describe-level mock overrides, e.g. a mocked back office. */
  async useDefaults(...routes: MockRoute[]): Promise<void> {
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
   * How many requests to an endpoint the page has sent since this mock was created, mocked or
   * real. A snapshot: pair it with `expect.poll` to prove that something is (not) sent, e.g.
   * `await expect.poll(() => apiMock.requestsTo('POST', '/users/register')).toBe(0)`.
   */
  requestsTo(method: HttpMethod, path: MockRoute['path']): number {
    return this.sent.filter((r) => r.method === method && matches(path, r.pathname)).length;
  }

  /** Waits for the next request to an endpoint, mocked or real, and returns it. */
  waitForRequest(method: HttpMethod, path: MockRoute['path'], options: WaitOptions = {}): Promise<Request> {
    return this.page.waitForRequest((r) => r.method() === method && matches(path, apiPath(r.url())), options);
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
    let body: Record<string, unknown> = {};
    const response = await this.page.waitForResponse((r) => {
      const request = r.request();
      if (request.method() !== method || !matches(path, apiPath(r.url()))) return false;
      body = jsonBody(request);
      return bodyMatches(body);
    }, options);
    // A mocked error may answer with no JSON body: hand that back as undefined instead of throwing.
    const json = (await response.json().catch(() => undefined)) as T;
    return { response, body, json };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const pathname = apiPath(request.url());
    const all = [...this.routes, ...this.defaults];
    // A CORS preflight is answered only for a path some mock serves; otherwise the real API answers it,
    // so a missing CORS header on an unmocked endpoint still shows up.
    if (request.method() === 'OPTIONS') {
      return all.some((r) => matches(r.path, pathname)) ? route.fulfill({ status: 204, headers: CORS }) : route.fallback();
    }
    if (this.latencyMs) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    const match = all.find((r) => r.method === request.method() && matches(r.path, pathname));
    if (!match) {
      if (this.guardWrites && WRITES.has(request.method()) && !ANONYMOUS_CART_WRITES.some((w) => w.method === request.method() && w.path.test(pathname))) {
        this.blockedWrites.push(`${request.method()} ${pathname}`);
        return route.fulfill({ status: 418, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"Blocked by qa-lab: unmocked write"}' });
      }
      return route.fallback();
    }
    const index = this.served.get(match) ?? 0;
    this.served.set(match, index + 1);
    const response = match.responses[Math.min(index, match.responses.length - 1)];
    if ('abort' in response) return route.abort(response.abort);
    return route.fulfill({
      status: response.status,
      headers: { ...CORS, 'content-type': response.contentType ?? 'application/json' },
      body: response.body ?? (response.json === undefined ? '' : JSON.stringify(response.json)),
    });
  }
}

function isApiUrl(url: string): boolean {
  return url === API_URL || url.startsWith(`${API_URL}/`);
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
  return typeof path === 'string' ? pathname === path : path.test(pathname);
}

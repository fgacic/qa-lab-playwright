import type { Page, Request, Response, Route } from '@playwright/test';
import { API_URL } from './env';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'QUERY';
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * One mocked endpoint. `path` is the API path without the host: a string matches exactly,
 * a RegExp matches the pathname. Responses are served in order; the last one repeats.
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
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,QUERY,OPTIONS',
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
 */
export class ApiMock {
  private readonly routes: MockRoute[] = [];
  private readonly defaults: MockRoute[] = [];
  private installed = false;
  private guardWrites = false;
  /** Writes the guard refused (see `blockUnmockedWrites`). */
  readonly blockedWrites: string[] = [];

  constructor(private readonly page: Page) {}

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
   * admin specs turn this on so a gap in the mocks can never write to the real shared backend.
   */
  async blockUnmockedWrites(): Promise<void> {
    this.guardWrites = true;
    await this.install();
  }

  private async install(): Promise<void> {
    if (this.installed) return;
    this.installed = true;
    await this.page.route((url) => url.href.startsWith(API_URL), (route) => this.handle(route));
  }

  /** Waits for the next request to an endpoint, mocked or real, and returns it. */
  waitForRequest(method: HttpMethod, path: MockRoute['path']): Promise<Request> {
    return this.page.waitForRequest((r) => r.method() === method && matches(path, new URL(r.url()).pathname));
  }

  /**
   * Waits for the next response from an endpoint, optionally only for a request whose JSON
   * body matches (the product list is one endpoint for every filter, sort and page).
   */
  async waitForResponse<T = unknown>(
    method: HttpMethod,
    path: MockRoute['path'],
    bodyMatches: (body: Record<string, string>) => boolean = () => true,
  ): Promise<{ response: Response; body: Record<string, string>; json: T }> {
    let body: Record<string, string> = {};
    const response = await this.page.waitForResponse((r) => {
      const request = r.request();
      if (request.method() !== method || !matches(path, new URL(r.url()).pathname)) return false;
      body = (request.postDataJSON() as Record<string, string> | null) ?? {};
      return bodyMatches(body);
    });
    return { response, body, json: (await response.json()) as T };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const pathname = new URL(request.url()).pathname;
    const match = [...this.routes, ...this.defaults].find((r) => r.method === request.method() && matches(r.path, pathname));
    if (!match) {
      if (this.guardWrites && WRITES.has(request.method())) {
        this.blockedWrites.push(`${request.method()} ${pathname}`);
        return route.fulfill({ status: 418, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"message":"Blocked by qa-lab: unmocked write"}' });
      }
      return route.fallback();
    }
    const response = match.responses.length > 1 ? match.responses.shift()! : match.responses[0];
    if ('abort' in response) return route.abort(response.abort);
    return route.fulfill({
      status: response.status,
      headers: { ...CORS, 'content-type': response.contentType ?? 'application/json' },
      body: response.body ?? (response.json === undefined ? '' : JSON.stringify(response.json)),
    });
  }
}

function matches(path: MockRoute['path'], pathname: string): boolean {
  return typeof path === 'string' ? pathname === path : path.test(pathname);
}

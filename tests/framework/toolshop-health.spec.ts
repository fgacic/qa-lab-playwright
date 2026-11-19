// "The Toolshop is up" (scripts/lib/toolshop-health.mjs) and the suite's preflight in front of the first test (src/support/preflight.ts).
// Both are run against small HTTP servers that play a shop in each state: down, up but unseeded, answering without a total, healthy.
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { httpUrl } from '@support/urls';
import { probe, signInOnce, waitForToolshop } from '../../scripts/lib/toolshop-health.mjs';

const ROOT = join(__dirname, '..', '..');
const ADMIN = { email: 'admin@example.test', password: 'secret' };

interface Shop {
  /** The product list answers `{ total }`; `undefined` leaves it out, `'none'` answers an empty body that is not JSON. */
  total?: number | null | 'none';
  /** The UI serves the SPA's `<app-root>` (default) or something else. */
  ui?: 'app' | 'error-page';
  /** The admin login answers this status (default 200). */
  login?: number;
}

/** A shop on an ephemeral port, serving the SPA and the API from one origin as the self-hosted one does. */
async function shop(config: Shop): Promise<{ url: string; api: string; server: Server }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: string, type = 'application/json') => res.writeHead(status, { 'content-type': type }).end(body);
    if (req.url === '/api/products') return config.total === 'none' ? send(200, '') : send(200, JSON.stringify(config.total === undefined ? {} : { total: config.total }));
    if (req.url === '/api/users/login') return send(config.login ?? 200, '{"access_token":"t"}');
    if (req.url === '/') return config.ui === 'error-page' ? send(200, '<html>Bad gateway</html>', 'text/html') : send(200, '<html><app-root></app-root></html>', 'text/html');
    return send(404, '{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = httpUrl('127.0.0.1', '', (server.address() as AddressInfo).port);
  return { url, api: `${url}/api`, server };
}

/** An address nothing listens on: port 1 (tcpmux, which no machine of ours runs), so it cannot be taken by another process the way a port that was merely free a moment ago can. */
const closedUrl = (): string => httpUrl('127.0.0.1', '', 1);

test.describe('the toolshop health check', { tag: ['@framework'] }, () => {
  let open: Server[] = [];
  const start = async (config: Shop) => {
    const made = await shop(config);
    open.push(made.server);
    return made;
  };
  test.afterEach(async () => {
    await Promise.all(open.map((server) => new Promise((resolve) => server.close(resolve))));
    open = [];
  });

  test('a seeded shop is ok, and the admin signs in once', async () => {
    const { url, api } = await start({ total: 12 });
    expect(await probe({ api, ui: url })).toBe('ok');
    expect(await signInOnce({ api, admin: ADMIN })).toBe('ok');
    expect(await waitForToolshop({ api, ui: url, admin: ADMIN, timeoutMs: 2000, intervalMs: 50 })).toBe('ok');
  });

  for (const [name, config] of [
    ['an unseeded shop (no products)', { total: 0 }],
    ['an answer with no total at all', { total: undefined }],
    ['a total of null', { total: null }],
  ] as const) {
    test(`${name} is not ready`, async () => {
      const { url, api } = await start(config);
      expect(await probe({ api, ui: url })).toBe('API has no products yet');
      expect(await waitForToolshop({ api, ui: url, timeoutMs: 300, intervalMs: 50 }), 'the wait gives up with the same reason').toBe('API has no products yet');
    });
  }

  test('a UI that does not serve the app is not ready', async () => {
    const { url, api } = await start({ total: 3, ui: 'error-page' });
    expect(await probe({ api, ui: url })).toBe('UI not serving the app');
  });

  test('a seeded admin that cannot sign in is reported with the status, after the shop itself is ok', async () => {
    const { url, api } = await start({ total: 3, login: 401 });
    expect(await probe({ api, ui: url })).toBe('ok');
    expect(await waitForToolshop({ api, ui: url, admin: ADMIN, timeoutMs: 2000, intervalMs: 50 })).toBe('seeded admin cannot sign in (401)');
  });

  test('an unreachable target resolves to the reason within the deadline instead of hanging, and probe itself rejects', async () => {
    const url = closedUrl();
    await expect(probe({ api: `${url}/api`, ui: url })).rejects.toThrow();
    const state = await waitForToolshop({ api: `${url}/api`, ui: url, timeoutMs: 400, intervalMs: 50 });
    expect(state, 'ECONNREFUSED or the fetch failure, not "ok"').not.toBe('ok');
    expect(state).toMatch(/ECONNREFUSED|fetch failed/);
  });
});

test.describe('the preflight', { tag: ['@framework'] }, () => {
  let open: Server[] = [];
  test.afterEach(async () => {
    await Promise.all(open.map((server) => new Promise((resolve) => server.close(resolve))));
    open = [];
  });

  /**
   * The real globalSetup, in front of one empty test, against the given addresses. Asynchronous on purpose: a synchronous
   * spawn would block this process's event loop, and with it the fake shop the nested run is asking.
   */
  async function preflight(env: Record<string, string>): Promise<{ status: number | null; output: string }> {
    const child = spawn('npx', ['playwright', 'test', '--config=tests/framework/probe/playwright.preflight.config.ts'], {
      cwd: ROOT,
      env: { ...process.env, PREFLIGHT_TIMEOUT_MS: '1000', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => void (output += chunk));
    child.stderr.on('data', (chunk: Buffer) => void (output += chunk));
    const timer = setTimeout(() => child.kill(), 60_000);
    const status = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    }).finally(() => clearTimeout(timer));
    return { status, output };
  }

  test('a healthy self-hosted shop lets the run start', async () => {
    const made = await shop({ total: 5 });
    open.push(made.server);
    const { status, output } = await preflight({ TARGET: 'local', BASE_URL: made.url, API_URL: made.api });
    expect(status, output).toBe(0);
  });

  test('a self-hosted shop that is down stops the run before any test, naming the address and the way to start it', async () => {
    const url = closedUrl();
    const { status, output } = await preflight({ TARGET: 'local', BASE_URL: url, API_URL: `${url}/api` });
    expect(status).not.toBe(0);
    expect(output).toContain(`The self-hosted Toolshop at ${url} is not ready`);
    expect(output).toContain('npm run toolshop:up');
    expect(output).not.toContain('the run started');
  });

  test('a self-hosted shop that is up but unseeded stops the run with that reason', async () => {
    const made = await shop({ total: 0 });
    open.push(made.server);
    const { status, output } = await preflight({ TARGET: 'local', BASE_URL: made.url, API_URL: made.api });
    expect(status).not.toBe(0);
    expect(output).toContain('API has no products yet');
  });

  test('on the live target any HTTP answer lets the run start (a challenge page is the bot guard\'s to judge), a refused connection does not', async () => {
    const challenged = await shop({ total: 0, ui: 'error-page' });
    open.push(challenged.server);
    expect((await preflight({ TARGET: 'live', BASE_URL: challenged.url, API_URL: challenged.api })).status, 'a page that is not the shop still answers').toBe(0);
    const url = closedUrl();
    const down = await preflight({ TARGET: 'live', BASE_URL: url, API_URL: `${url}/api` });
    expect(down.status).not.toBe(0);
    expect(down.output).toContain('is not reachable');
  });
});

// The suite's target configuration under test: src/support/env.ts, which runs when playwright.config.ts loads. Each case loads the
// config in a fresh process with its own environment (`playwright test --list`), so what env.ts refuses is asserted from the outside.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { httpUrl, httpsUrl } from '@support/urls';

const ROOT = join(__dirname, '..', '..');
// Each `--list` below loads the config in a fresh process: the spawn's own limit, and the budget of a test that runs one (or three) of them.
const CONFIG_LOAD_MS = 60_000;

test.describe('the target configuration', { tag: ['@framework'] }, () => {
  /** `playwright test --list` loads the config in a fresh process with this environment, which is where env.ts runs. */
  test.describe.configure({ timeout: 3 * CONFIG_LOAD_MS + 15_000 }); // the loopback test loads the config three times
  const loadConfig = (env: Record<string, string>) =>
    spawnSync('npx', ['playwright', 'test', '--list', '--project=framework'], { cwd: ROOT, timeout: CONFIG_LOAD_MS, encoding: 'utf8', env: { ...process.env, ...env } });

  test('a local target whose BASE_URL and API_URL are on different origins is refused', () => {
    const base = httpUrl('localhost');
    const api = httpUrl('localhost', '/api', 8091);
    const run = loadConfig({ TARGET: 'local', BASE_URL: base, API_URL: api });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain(`BASE_URL (${base}) and API_URL (${api}) on the same origin`);
  });

  /** BASE_URL and API_URL of a shop at `host`: the self-hosted layout, the API under /api on the same origin. */
  const urls = (host: string) => ({ BASE_URL: httpUrl(host), API_URL: httpUrl(host, '/api') });
  const REFUSED_ENV: { name: string; env: Record<string, string>; message: RegExp }[] = [
    { name: 'an unknown TARGET', env: { TARGET: 'prod' }, message: /Unknown TARGET "prod"/ },
    { name: 'a host that merely starts with localhost', env: urls('localhost.evil.com'), message: /are not local/ },
    { name: 'a userinfo that spells localhost before the real host', env: urls('localhost@evil.com'), message: /are not local/ },
    { name: '0.0.0.0, which is not our loopback', env: urls('0.0.0.0'), message: /are not local/ },
    { name: 'an IPv6 literal that is not ::1', env: urls('[::2]'), message: /are not local/ },
    { name: 'a private LAN address', env: urls('192.168.1.5'), message: /are not local/ },
    { name: 'a local BASE_URL with a live API_URL', env: { BASE_URL: httpUrl('localhost'), API_URL: httpsUrl('api.practicesoftwaretesting.com') }, message: /are not local/ },
  ];
  for (const { name, env, message } of REFUSED_ENV) {
    test(`TARGET=local refuses ${name}`, () => {
      const run = loadConfig({ TARGET: 'local', ...env });
      expect(run.status, `${run.stdout}${run.stderr}`).not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toMatch(message);
    });
  }

  test('the loopback spellings of this machine are accepted', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const run = loadConfig({ TARGET: 'local', ...urls(host) });
      expect(run.status, `${host}: ${run.stdout}${run.stderr}`).toBe(0);
    }
  });

  test('TARGET=live accepts the public addresses, and its write guard default is on', () => {
    const run = loadConfig({ TARGET: 'live' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });

  test('a run that schedules perf next to another project is refused at load time when --reporter replaced the guard', () => {
    const run = spawnSync('npx', ['playwright', 'test', '--project=perf', '--project=chromium', '--reporter=dot', '--grep=@nothing-has-this-tag'], { cwd: ROOT, timeout: CONFIG_LOAD_MS, encoding: 'utf8', env: process.env });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toMatch(/perf budgets must run alone/);
  });

  test('a trailing slash on API_URL is dropped, so the API prefix still matches', () => {
    const run = loadConfig({ TARGET: 'local', BASE_URL: httpUrl('localhost'), API_URL: httpUrl('localhost', '/api/') });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  });
});

import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test';
import { apiOnlyTest as test, expect } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { skipIfChallengedResponse } from '@support/bot-challenge';
import { API_URL, BASE_URL } from '@support/env';
import { hstsMaxAge, isNosniff, keepsReferrerPrivate, limitsScripts, MIN_HSTS_MAX_AGE_SECONDS, restrictsFraming, SAFE_REFERRER_POLICIES, switchesOff, UNSAFE_SCRIPT_SOURCES } from '@support/security-headers';
import { httpsUrl } from '@support/urls';

/**
 * Response headers of the real deployment. Only meaningful on the live site: the self-hosted
 * stack's nginx is ours, not the product's. These are a soft, defence-in-depth signal; each
 * missing header is pinned as a known finding, so the nightly live run turns red when one appears.
 *
 * Each pin first checks, outside the bug assertion, that the shop answered (a Cloudflare
 * challenge skips the test; any other non-2xx fails it without naming the pin), so a block page
 * can never stand in for "the header is missing". The bug assertion states the value a fixed
 * site would send, not just that the header exists. Plain HTTP, no browser: the file runs on the browserless `apiOnlyTest`,
 * and a challenge is recognised by Cloudflare's `cf-mitigated: challenge` response header.
 *
 * Defect ids: SEC-01..06 are the pins below; the next free one is SEC-15 (the registry in docs/COVERAGE.md is the source).
 * What counts as a good header value is judged by the matchers in src/support/security-headers.ts, which
 * tests/security/header-matchers.spec.ts runs offline on sample values, on the gate.
 *
 * The whole file is `@live-only`: it never runs on the CI gate, which is the self-hosted target (the nginx there is ours, not the
 * product's). It runs in the nightly live run only, so a change here is not exercised by a pull request.
 */

const expected: { id: string; header: string; ok: (value: string) => boolean; accepts: string; why: string }[] = [
  {
    id: 'SEC-01',
    header: 'content-security-policy',
    // A policy that names no script source limits nothing, and one that allows inline script does not stop injected script.
    // A bare "*" (or "https:", "http:") allows scripts from anywhere, "data:" lets a payload carry its own script, and 'unsafe-eval'
    // turns text into code: none of them limits where scripts come from (UNSAFE_SCRIPT_SOURCES).
    ok: limitsScripts,
    accepts: `a default-src or script-src, and none of ${UNSAFE_SCRIPT_SOURCES.join(', ')} in the one that governs scripts`,
    why: 'no Content-Security-Policy that limits where scripts may load from',
  },
  { id: 'SEC-03', header: 'x-content-type-options', ok: isNosniff, accepts: 'nosniff', why: 'no X-Content-Type-Options: nosniff' },
  {
    id: 'SEC-04',
    header: 'referrer-policy',
    ok: keepsReferrerPrivate,
    accepts: `one of ${SAFE_REFERRER_POLICIES.join(', ')}`,
    why: 'no Referrer-Policy that keeps the full URL from other origins',
  },
  { id: 'SEC-05', header: 'strict-transport-security', ok: (value) => hstsMaxAge(value) >= MIN_HSTS_MAX_AGE_SECONDS, accepts: `a max-age of at least ${MIN_HSTS_MAX_AGE_SECONDS} seconds`, why: 'no Strict-Transport-Security (HSTS) with a long max-age' },
];

/** The shop's own answer, once it has given one: a Cloudflare challenge skips, any other error fails. */
async function shopAnswer(request: APIRequestContext, testInfo: TestInfo): Promise<APIResponse> {
  const response = await request.get(BASE_URL);
  await testInfo.attach('headers.json', { body: JSON.stringify(response.headers(), null, 2), contentType: 'application/json' });
  skipIfChallengedResponse(response);
  expect(response.status(), 'the shop answered before its headers are judged').toBeLessThan(400);
  return response;
}

/** The shop's response headers, once it has answered. */
async function shopHeaders(request: APIRequestContext, testInfo: TestInfo) {
  return (await shopAnswer(request, testInfo)).headers();
}

/** What the report says of the cookies read: the count, and for none that there was nothing to check (a pass that vouches for no cookie). */
function cookiesInspected(count: number): string {
  return count ? String(count) : '0: the shop and its API set no cookie, so there was nothing to check; this pass says so, it does not vouch for a cookie';
}

test.describe('Security headers of the live shop', { tag: ['@security', '@live-only', '@bug'] }, () => {
  for (const { id, header, ok, accepts, why } of expected) {
    test(`the shop sends ${header}`, async ({ request }, testInfo) => {
      knownBug(id, why);
      const headers = await shopHeaders(request, testInfo);

      const sent = headers[header] ?? '';
      expect(ok(sent), `${id}: ${why} (sent "${sent}", wanted ${accepts})`).toBe(true);
    });
  }

  test('the shop cannot be framed', async ({ request }, testInfo) => {
    knownBug('SEC-02', 'no X-Frame-Options (or CSP frame-ancestors): the shop can be framed (clickjacking)');
    const headers = await shopHeaders(request, testInfo);

    const frameOptions = (headers['x-frame-options'] ?? '').trim();
    const policy = headers['content-security-policy'] ?? '';

    expect(restrictsFraming({ frameOptions, policy }), `SEC-02: neither X-Frame-Options ("${frameOptions}") nor CSP frame-ancestors ("${policy}") restricts framing`).toBe(true);
  });

  test('the API does not disclose its server version', async ({ request }) => {
    knownBug('SEC-06', 'the API answers with "Server: Apache/2.4.52 (Ubuntu)", disclosing product, version and OS.');
    const response = await request.get(`${API_URL}/status`);
    skipIfChallengedResponse(response);
    expect(response.status(), 'the API answered before its headers are judged').toBeLessThan(400);

    expect(response.headers()['server'] ?? '', 'SEC-06: the Server header names a product version').not.toMatch(/\d+\.\d+/);
  });
});

// Not pins, so a describe of their own without @bug (verify-bugs.mjs treats every @bug test as a pin that must fail).
test.describe('Cookies, CORS and Permissions-Policy of the live shop', { tag: ['@security', '@live-only'] }, () => {
  // The checks below are not pins: nothing is known about the live site's answer yet, so each states the behaviour a
  // hardened site shows and is judged on its own value. A red nightly run is the finding; pin it under the next free SEC id (SEC-18) then.
  // They are @live-only, like the rest of the file, because the self-hosted nginx is ours and not the product.

  test('every cookie the shop and its API set, if any, is Secure, HttpOnly and has a SameSite', async ({ request }, testInfo) => {
    // Both must have answered (a challenge skips): a block page or an error sets no cookies, and "none" would read as "all fine".
    const api = await request.get(`${API_URL}/status`);
    skipIfChallengedResponse(api);
    expect(api.status(), 'the API answered before its cookies are judged').toBeLessThan(400);
    const answers = [await shopAnswer(request, testInfo), api];
    const cookies = answers.flatMap((answer) => answer.headersArray().filter(({ name }) => name.toLowerCase() === 'set-cookie').map(({ value }) => value));
    // A shop that sets no cookie has nothing to misconfigure (hence "if any" in the title), but the count is recorded so "none" is a stated fact and not an unread loop.
    testInfo.annotations.push({ type: 'cookies inspected', description: cookiesInspected(cookies.length) });

    for (const cookie of cookies) {
      const name = cookie.split('=')[0];
      expect.soft(cookie, `${name} is Secure`).toMatch(/;\s*secure(;|$)/i);
      expect.soft(cookie, `${name} is HttpOnly`).toMatch(/;\s*httponly(;|$)/i);
      expect.soft(cookie, `${name} has a SameSite`).toMatch(/;\s*samesite=(strict|lax|none)(;|$)/i);
    }
  });

  test('the API does not let another origin read it with credentials', async ({ request }) => {
    const origin = httpsUrl('attacker.example');
    const response = await request.get(`${API_URL}/status`, { headers: { origin } });
    skipIfChallengedResponse(response);
    expect(response.status(), 'the API answered before its headers are judged').toBeLessThan(400);

    const allowedOrigin = response.headers()['access-control-allow-origin'] ?? '';
    const withCredentials = (response.headers()['access-control-allow-credentials'] ?? '').toLowerCase() === 'true';
    // Public data may be read cross-origin ("*" or a reflected origin), but never together with credentials.
    expect(withCredentials && (allowedOrigin === origin || allowedOrigin === '*'), `an unknown origin may read the API with credentials (allow-origin "${allowedOrigin}", allow-credentials true)`).toBe(false);
  });

  test('the shop sends a Permissions-Policy that switches off the camera, microphone and geolocation', async ({ request }, testInfo) => {
    const headers = await shopHeaders(request, testInfo);

    const policy = headers['permissions-policy'] ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect.soft(switchesOff(policy, feature), `Permissions-Policy turns ${feature} off (sent "${policy}")`).toBe(true);
    }
  });
});

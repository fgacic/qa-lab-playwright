import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { skipIfBotChallenge } from '@support/bot-challenge';
import { API_URL, BASE_URL } from '@support/env';

/**
 * Response headers of the real deployment. Only meaningful on the live site: the self-hosted
 * stack's nginx is ours, not the product's. These are a soft, defence-in-depth signal; each
 * missing header is pinned as a known finding, so the nightly live run turns red when one appears.
 *
 * Each pin first checks, outside the bug assertion, that the shop answered (a Cloudflare
 * challenge skips the test; any other non-2xx fails it without naming the pin), so a block page
 * can never stand in for "the header is missing". The bug assertion states the value a fixed
 * site would send, not just that the header exists.
 */
const expected = [
  { id: 'SEC-01', header: 'content-security-policy', value: /\S/, why: 'no Content-Security-Policy: nothing limits where scripts may load from' },
  { id: 'SEC-03', header: 'x-content-type-options', value: /^nosniff$/i, why: 'no X-Content-Type-Options: nosniff' },
  { id: 'SEC-04', header: 'referrer-policy', value: /\S/, why: 'no Referrer-Policy' },
  { id: 'SEC-05', header: 'strict-transport-security', value: /max-age=\d{7,}/, why: 'no Strict-Transport-Security (HSTS) with a long max-age' },
];

/** The shop's response headers, once it has answered: a Cloudflare challenge skips, any other error fails. */
async function shopHeaders({ request, page }: { request: APIRequestContext; page: Page }, testInfo: TestInfo) {
  const response = await request.get(BASE_URL);
  if (response.status() === 403) {
    await page.goto(BASE_URL);
    await skipIfBotChallenge(page);
  }
  await testInfo.attach('headers.json', { body: JSON.stringify(response.headers(), null, 2), contentType: 'application/json' });
  expect(response.status(), 'the shop answered before its headers are judged').toBeLessThan(400);
  return response.headers();
}

test.describe('Security headers of the live shop', { tag: ['@security', '@live-only', '@bug'] }, () => {
  for (const { id, header, value, why } of expected) {
    test(`the shop sends ${header}`, async ({ request, page }, testInfo) => {
      knownBug(id, why);
      const headers = await shopHeaders({ request, page }, testInfo);

      expect(headers[header] ?? '', `${id}: ${why}`).toMatch(value);
    });
  }

  test('the shop cannot be framed', async ({ request, page }, testInfo) => {
    knownBug('SEC-02', 'no X-Frame-Options (or CSP frame-ancestors): the shop can be framed (clickjacking)');
    const headers = await shopHeaders({ request, page }, testInfo);

    const framing = `${headers['x-frame-options'] ?? ''} ${headers['content-security-policy'] ?? ''}`;
    expect(framing, 'SEC-02: neither X-Frame-Options nor CSP frame-ancestors restricts framing').toMatch(/\b(deny|sameorigin)\b|frame-ancestors\s+(?!\*)\S/i);
  });

  test('the API does not disclose its server version', async ({ request }) => {
    knownBug('SEC-06', 'the API answers with "Server: Apache/2.4.52 (Ubuntu)", disclosing product, version and OS.');
    const response = await request.get(`${API_URL}/status`);
    expect(response.status(), 'the API answered before its headers are judged').toBeLessThan(400);

    expect(response.headers()['server'] ?? '', 'SEC-06: the Server header names a product version').not.toMatch(/\d+\.\d+/);
  });
});

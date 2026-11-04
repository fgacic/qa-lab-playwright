import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { API_URL, BASE_URL } from '@support/env';

/**
 * Response headers of the real deployment. Only meaningful on the live site: the self-hosted
 * stack's nginx is ours, not the product's. These are a soft, defence-in-depth signal; each
 * missing header is pinned as a known finding, so the nightly live run turns red when one appears.
 */
const expected = [
  { id: 'SEC-01', header: 'content-security-policy', why: 'no Content-Security-Policy: nothing limits where scripts may load from' },
  { id: 'SEC-02', header: 'x-frame-options', why: 'no X-Frame-Options (or CSP frame-ancestors): the shop can be framed (clickjacking)' },
  { id: 'SEC-03', header: 'x-content-type-options', why: 'no X-Content-Type-Options: nosniff' },
  { id: 'SEC-04', header: 'referrer-policy', why: 'no Referrer-Policy' },
  { id: 'SEC-05', header: 'strict-transport-security', why: 'no Strict-Transport-Security (HSTS)' },
];

test.describe('Security headers of the live shop', { tag: ['@security', '@live-only'] }, () => {
  for (const { id, header, why } of expected) {
    test(`the shop sends ${header}`, async ({ request }, testInfo) => {
      knownBug(id, why);
      const response = await request.get(BASE_URL);
      await testInfo.attach('headers.json', { body: JSON.stringify(response.headers(), null, 2), contentType: 'application/json' });
      expect(response.ok()).toBe(true);

      expect(response.headers()[header], header).toBeDefined();
    });
  }

  test('the API does not disclose its server version', async ({ request }) => {
    knownBug('SEC-06', 'the API answers with "Server: Apache/2.4.52 (Ubuntu)", disclosing product, version and OS.');
    const response = await request.get(`${API_URL}/status`);
    expect(response.ok()).toBe(true);

    expect(response.headers()['server'] ?? '').not.toMatch(/\d+\.\d+/);
  });
});

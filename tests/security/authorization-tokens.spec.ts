import { mergeTests } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { worldTest } from '@fixtures/security';
import { call, newCustomer, REFUSED } from '@support/authz';
import { knownBug } from '@support/known-bug';
import { base64Url, fakeJwt, fromBase64Url } from '@support/payloads';

/**
 * Authorisation of the API itself, below the UI: who may call what. This file: Tokens: forgeries the API did not sign, and tokens that outlived their session. (The authorization-*.spec.ts files are one suite, split by concern.) A page only hides a button, the API is what enforces,
 * so these are plain HTTP calls with no token, with a customer's token and with the admin's. They write to our own
 * database and try to read other people's data, so they only ever run against the self-hosted Toolshop (@self-hosted).
 * No browser is involved, so the file is tagged @api and scheduled once (in Chromium) instead of once per browser.
 *
 * A call is refused by 401 (no valid token) or 403 (a token that may not), and a record that belongs to somebody else is
 * hidden by a 403 or a 404: all of those count as "refused". A success (2xx) is "accepted". Any other answer (a 404 on a
 * route that should exist, a 405, a 500) is neither: it says nothing about authorisation, so it fails the test without
 * naming a defect id. Every "refused" check that tolerates a 404 comes after a control in which the admin gets a 200 from the
 * same path, so a typo in a path cannot pass as a refusal.
 *
 * What each test makes, it removes again, pass or fail, in reverse order: the records the admin API can delete (brands,
 * categories, products, the customers a test registers, the favourites that would block deleting them). Two kinds are left
 * behind on purpose, all uniquely named and harmless on the throwaway database of the self-hosted target, which is rebuilt
 * for every CI run: guest orders (DELETE /invoices/{id} answers 405) and contact messages (DELETE /messages/{id} answers 405).
 * No seeded record is ever changed: a first draft of the catalogue pins edited a seeded product to prove a point, which
 * is why every write is aimed at a record the test made.
 *
 * The file runs on `apiOnlyTest`: no browser context is opened, since every check is a plain HTTP call.
 */
const test = mergeTests(apiOnlyTest, worldTest);

/**
 * A token the API itself did not sign must be refused as no token at all (401). Each forgery is built from the admin's real
 * token or from scratch, and each is judged against the same admin-only path where the real token gets a 200, so a refusal is
 * about the signature and not about the path.
 */
test.describe('API authorisation, forged tokens (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  const ADMIN_PATH = '/users';

  /** The forgeries, as functions of a real admin token (`header.payload.signature`). */
  const FORGERIES: Record<string, (real: string) => string> = {
    'the admin token with a changed signature': (real) => {
      const [header, payload, signature] = real.split('.');
      return `${header}.${payload}.${signature.slice(0, -4)}${signature.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    },
    'the admin token with an altered payload and the old signature': (real) => {
      const [header, payload, signature] = real.split('.');
      const claims = fromBase64Url<Record<string, unknown>>(payload);
      return `${header}.${base64Url({ ...claims, exp: (claims.exp as number) + 3600 })}.${signature}`;
    },
    'the admin claims with alg "none" and no signature': (real) => `${base64Url({ typ: 'JWT', alg: 'none' })}.${real.split('.')[1]}.`,
    'the admin claims with alg "none" and the old signature': (real) => `${base64Url({ typ: 'JWT', alg: 'none' })}.${real.split('.')[1]}.${real.split('.')[2]}`,
    'a made-up admin token that was never signed': () => fakeJwt('admin'),
    'text that is not a token at all': () => 'not.a.jwt',
  };

  test('the admin token itself is accepted on the path the forgeries are sent to', async ({ request, adminToken }) => {
    const response = await call(request, 'GET', ADMIN_PATH, { token: await adminToken() });

    expect(response.status(), `GET ${ADMIN_PATH} as the admin answered`).toBe(200);
  });

  // The other direction: a real customer's token, with its claims promoted to admin and the old signature. The signature is what
  // makes the claims the API's own, so it must not let a customer write their own role.
  test('a customer token with its role changed to admin and the old signature is refused', async ({ request, api, adminToken, cleanups }) => {
    const { token } = await newCustomer({ request, api, adminToken, cleanups });
    const [header, payload, signature] = token.split('.');
    const claims = fromBase64Url<Record<string, unknown>>(payload);
    expect(claims.role, 'the customer token carries the role the forgery changes').toBe('user');
    const forged = `${header}.${base64Url({ ...claims, role: 'admin' })}.${signature}`;

    const response = await call(request, 'GET', ADMIN_PATH, { token: forged });

    expect(response.status(), `GET ${ADMIN_PATH} with a customer token promoted to admin answered`).toBe(401);
  });

  for (const [name, forge] of Object.entries(FORGERIES)) {
    test(`${name} is refused`, async ({ request, adminToken }) => {
      const forged = forge(await adminToken());

      const response = await call(request, 'GET', ADMIN_PATH, { token: forged });

      expect(response.status(), `GET ${ADMIN_PATH} with ${name} answered`).toBe(401);
    });
  }
});

/**
 * A token that was valid, and whose session or account has ended since: it must stop working at once, not when it expires. The
 * token is a real one in both cases (a fresh sign-in), judged on `GET /users/me`, where it works until the session ends.
 */
test.describe('API authorisation, tokens after the session ended (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  test('a token is refused once its holder signed out', async ({ request, api, adminToken, cleanups }) => {
    const { token } = await newCustomer({ request, api, adminToken, cleanups });
    expect((await call(request, 'GET', '/users/me', { token })).status(), 'the token worked before signing out').toBe(200);
    expect((await call(request, 'GET', '/users/logout', { token })).status(), 'signing out answered').toBe(200);

    const response = await call(request, 'GET', '/users/me', { token });

    expect(response.status(), 'GET /users/me with the token of a signed-out session answered').toBe(401);
  });

  test.describe('after the account was deleted', { tag: ['@bug'] }, () => {
    // Every call a signed-in customer makes with the token, each judged on its own: the deleted account is gone for the admin, so any of
    // them that still answers 200 is a token that outlived it. The pin is soft per call, so one answer cannot hide another.
    const WITH_A_TOKEN = ['/users/me', '/invoices', '/favorites', '/messages', '/users/refresh'];

    test('a token of a deleted account is refused', async ({ request, api, adminToken, cleanups }) => {
      knownBug('SEC-14', "the token of an account the admin deleted is still accepted: GET /users/me, /invoices, /favorites, /messages and /users/refresh answer 200 as the deleted customer.");
      const { id, customer } = await newCustomer({ request, api, adminToken, cleanups });
      // Every path gets two sign-ins of its own: one used now, as the control that the call works with a token of this account, and one kept
      // untouched for after the deletion. Not one token for everything: `/users/refresh` retires the token it is called with, so a control
      // made with the kept token would end it and the pin could pass for that reason, not because the deleted account was refused.
      const kept: Record<string, string> = {};
      for (const path of WITH_A_TOKEN) {
        const control = await api.login(customer.email, customer.password);
        expect((await call(request, 'GET', path, { token: control })).status(), `GET ${path} worked with a token of this account before it was deleted`).toBe(200);
        kept[path] = await api.login(customer.email, customer.password);
      }
      const admin = await adminToken();
      await api.deleteUser(admin, id);
      // Precondition, true whether or not the bug is fixed: the account is gone for the admin, so what is wrong is only that the token outlived it.
      expect((await call(request, 'GET', `/users/${id}`, { token: admin })).status(), 'the admin no longer finds the deleted account').toBe(404);

      for (const path of WITH_A_TOKEN) {
        const response = await call(request, 'GET', path, { token: kept[path] });
        expect.soft(REFUSED, `SEC-14: GET ${path} with a token of a deleted account answered ${response.status()}`).toContain(response.status());
      }
    });
  });
});

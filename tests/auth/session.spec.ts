import { apiOnlyTest as test, expect } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { API_URL } from '@support/env';
import { fakeCustomer } from '@support/test-data';

const REFRESH_URL = `${API_URL}/users/refresh`;

/**
 * The session endpoints, judged on their own, in plain HTTP. `GET /users/refresh` is what the SPA calls on every protected
 * route a signed-out visitor opens, so its answer is the first thing a refused visitor's browser logs.
 */
test.describe('Session refresh', { tag: ['@self-hosted', '@api'] }, () => {
  // The control for the pin below: refresh works for a valid token, so the pin fails on the missing-token branch alone and not
  // because the endpoint is broken as a whole.
  test('refreshing with a valid token answers 200 with a new token that signs in', async ({ request, api }) => {
    const customer = fakeCustomer();
    await api.registerCustomer(customer);
    const token = await api.login(customer.email, customer.password);

    const refreshed = await request.get(REFRESH_URL, { headers: { authorization: `Bearer ${token}` } });

    expect(refreshed.status(), 'a valid token is refreshed').toBe(200);
    const { access_token: renewed } = await refreshed.json();
    expect(renewed, 'a token comes back').toEqual(expect.any(String));
    expect((await api.me(renewed)).email, 'the new token signs in as the same customer').toBe(customer.email);
  });

  test('refreshing with no token or a garbage one is refused with 401, not a server error', { tag: ['@negative', '@bug'] }, async ({ request }) => {
    knownBug('BUG-54', 'GET /users/refresh with no valid token answers 500 (an unhandled JWTException) instead of 401, so every signed-out visit of a protected page logs a server error.');
    // The refusal of a token the shop does not know is the same request for the shop, one without a header and one with a garbage token.
    const anonymous = await request.get(REFRESH_URL);
    const garbage = await request.get(REFRESH_URL, { headers: { authorization: 'Bearer not-a-token' } });

    expect(anonymous.status(), 'BUG-54: no token is refused with 401').toBe(401);
    expect(garbage.status(), 'BUG-54: a garbage token is refused with 401').toBe(401);
  });
});

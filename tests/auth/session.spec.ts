import { apiOnlyTest as test, expect } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { API_URL } from '@support/env';

/**
 * The session endpoints, judged on their own, in plain HTTP. `GET /users/refresh` is what the SPA calls on every protected
 * route a signed-out visitor opens, so its answer is the first thing a refused visitor's browser logs.
 */
test.describe('Session refresh', { tag: ['@negative', '@self-hosted', '@api'] }, () => {
  test('refreshing with no token or a garbage one is refused with 401, not a server error', { tag: ['@bug'] }, async ({ request }) => {
    knownBug('BUG-54', 'GET /users/refresh with no valid token answers 500 (an unhandled JWTException) instead of 401, so every signed-out visit of a protected page logs a server error.');
    // The refusal of a token the shop does not know is the same request for the shop, one without a header and one with a garbage token.
    const anonymous = await request.get(`${API_URL}/users/refresh`);
    const garbage = await request.get(`${API_URL}/users/refresh`, { headers: { authorization: 'Bearer not-a-token' } });

    expect(anonymous.status(), 'BUG-54: no token is refused with 401').toBe(401);
    expect(garbage.status(), 'BUG-54: a garbage token is refused with 401').toBe(401);
  });
});

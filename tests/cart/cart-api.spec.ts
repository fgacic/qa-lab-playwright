import type { APIRequestContext } from '@playwright/test';
import { apiOnlyTest as test, expect } from '@fixtures';
import { API_URL } from '@support/env';
import { knownBug } from '@support/known-bug';

/**
 * What the cart endpoint accepts, asked over HTTP: the half of BUG-44 the page cannot show. The cart page
 * lists an out-of-stock line like any other, and the UI refuses to add one, so the API is the only place
 * where the shop's own rule can be seen (or found missing). Carts are anonymous and hold nothing but the line.
 */
/** Without it Laravel answers a refusal with a redirect instead of a 4xx. */
const JSON_ONLY = { accept: 'application/json' };

/**
 * Adds one unit of a product to a cart, raw, not through the `api` client: the client throws on any non-2xx answer, and this
 * spec asserts the shop's status (200, or the refusal) itself.
 */
const addOne = (request: APIRequestContext, cartId: string, productId: string) =>
  request.post(`${API_URL}/carts/${cartId}`, { headers: JSON_ONLY, data: { product_id: productId, quantity: 1 } });

test.describe('Adding to a cart through the API', { tag: ['@api'] }, () => {
  test('a product in stock is added', async ({ api, catalog, request }) => {
    const cartId = await api.createCart([]);
    const product = await catalog.inStock();

    const response = await addOne(request, cartId, product.id);

    expect(response.status(), 'the shop adds a product that is in stock').toBe(200);
  });

  test('a product that is out of stock is refused', { tag: ['@negative', '@bug'] }, async ({ api, catalog, request }) => {
    knownBug('BUG-68', 'POST /carts/{id} adds a product that is out of stock (200, "item added or updated"), so the cart holds a line that cannot be bought.');
    const cartId = await api.createCart([]);
    const product = await catalog.outOfStock();
    expect(product.in_stock, 'the product is out of stock').toBe(false);

    const response = await addOne(request, cartId, product.id);

    expect(response.status(), 'BUG-68: the shop refuses an out-of-stock product').toBeGreaterThanOrEqual(400);
  });
});

import type { APIRequestContext } from '@playwright/test';
import { apiOnlyTest as test, expect } from '@fixtures';
import { UNKNOWN_PRODUCT_ID } from '@support/catalog-terms';
import { API_URL } from '@support/env';
import { knownBug } from '@support/known-bug';

/** Without it Laravel answers a refusal with a redirect instead of a 4xx. */
const JSON_ONLY = { accept: 'application/json' };

/**
 * Posts a line to a cart, raw, not through the `api` client: the client throws on any non-2xx answer, and this
 * spec asserts the shop's status (200, or the refusal) itself.
 */
const postLine = (request: APIRequestContext, cartId: string, data: Record<string, unknown>) =>
  request.post(`${API_URL}/carts/${cartId}`, { headers: JSON_ONLY, data });

/** One unit of a product: the line every add here is made of. */
const addOne = (request: APIRequestContext, cartId: string, productId: string) => postLine(request, cartId, { product_id: productId, quantity: 1 });

/** Lines the cart endpoint refuses as invalid (422), built from a product in stock: the quantity cases carry a real one, so only the quantity can be what the shop objects to. */
const INVALID_LINES = [
  { name: 'a product no catalogue has', line: () => ({ product_id: UNKNOWN_PRODUCT_ID, quantity: 1 }) },
  { name: 'a quantity of 0', line: (id: string) => ({ product_id: id, quantity: 0 }) },
  { name: 'a negative quantity', line: (id: string) => ({ product_id: id, quantity: -1 }) },
  { name: 'a fractional quantity', line: (id: string) => ({ product_id: id, quantity: 1.5 }) },
  { name: 'no product at all', line: () => ({ quantity: 1 }) },
];
const UNPROCESSABLE = 422;
const UNKNOWN_CART_ID = 'qa-lab-no-such-cart';

/**
 * What the cart endpoint accepts, asked over HTTP: the half of BUG-44 the page cannot show. The cart page
 * lists an out-of-stock line like any other, and the UI refuses to add one, so the API is the only place
 * where the shop's own rule can be seen (or found missing). Carts are anonymous and hold nothing but the line.
 */
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

  for (const { name, line } of INVALID_LINES) {
    test(`${name} is refused as invalid`, { tag: ['@negative'] }, async ({ api, catalog, request }) => {
      const cartId = await api.createCart([]);
      const product = await catalog.inStock();

      const response = await postLine(request, cartId, line(product.id));

      expect(response.status(), `the shop refuses ${name}`).toBe(UNPROCESSABLE);
    });
  }

  test('a cart that does not exist is refused as missing', { tag: ['@negative'] }, async ({ catalog, request }) => {
    const product = await catalog.inStock();

    const response = await addOne(request, UNKNOWN_CART_ID, product.id);

    expect(response.status(), 'the shop refuses a cart nobody created').toBe(404);
  });
});

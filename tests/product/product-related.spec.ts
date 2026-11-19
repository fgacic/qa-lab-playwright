import { apiOnlyTest as test, expect } from '@fixtures';
import { UNKNOWN_PRODUCT_ID } from '@support/catalog-terms';
import { API_URL } from '@support/env';
import { knownBug } from '@support/known-bug';

/** The product endpoints, judged on their own in plain HTTP (no page is opened, so each runs once, in Chromium). */
test.describe('Related products endpoint', { tag: ['@api'] }, () => {
  test('the related products of a product never include the product itself', async ({ catalog, request }) => {
    const product = await catalog.inStock();

    const response = await request.get(`${API_URL}/products/${product.id}/related`);

    expect(response.status(), 'the related products are answered').toBe(200);
    const related: { id: string }[] = await response.json();
    expect(related.length, 'the product has related products to judge').toBeGreaterThan(0);
    expect(related.map((p) => p.id), 'the product is not related to itself').not.toContain(product.id);
  });
});

/** The same endpoint for an id no product has. */
test.describe('Product endpoints for an id no product has', { tag: ['@api', '@negative'] }, () => {
  test('the related products of it are refused as missing, not as a server error', { tag: ['@bug'] }, async ({ request }) => {
    knownBug('BUG-62', 'GET /products/<unknown id>/related answers 500 with an HTML error page, where GET /products/<unknown id> answers 404 with a JSON message.');
    const product = await request.get(`${API_URL}/products/${UNKNOWN_PRODUCT_ID}`);
    // Holds whether or not the related endpoint is fixed: the product itself is refused as missing.
    expect(product.status(), 'the unknown product is refused as missing').toBe(404);

    const related = await request.get(`${API_URL}/products/${UNKNOWN_PRODUCT_ID}/related`);

    expect(related.status(), 'BUG-62: the related products of a missing product are refused as missing too').toBe(404);
  });
});

// The arranging helpers the security and admin specs clean up with (src/support/toolshop-api.ts): create a brand and a product, register
// a customer, find it again by its email, delete all three. Against the self-hosted shop (they write), no browser.
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { apiOnlyTest as test, expect } from '@fixtures';
import { ToolshopApi } from '@support/toolshop-api';
import { fakeCustomer } from '@support/test-data';

test.describe('the Toolshop API helpers', { tag: ['@framework', '@self-hosted'] }, () => {
  test('a brand, a product and a customer can be created, found and deleted again', async ({ api, adminToken }) => {
    const token = await adminToken();
    const suffix = randomUUID().slice(0, 8);
    const brand = await api.createBrand(token, { name: `QaLab Brand ${suffix}`, slug: `qalab-${suffix}` });
    const [category] = await api.categoryTree();
    const imageId = await api.firstImageId();
    let productId: string | undefined;
    const customer = fakeCustomer();
    let userId: string | undefined;
    try {
      const product = await api.createProduct(token, {
        name: `QaLab Product ${suffix}`, description: 'made by the framework spec', price: 9.5, category_id: category.id, brand_id: brand.id, product_image_id: imageId,
      });
      productId = product.id;
      expect((await api.findProductByName(token, product.name))?.id, 'the product is in the shop').toBe(product.id);

      await api.registerCustomer(customer);
      const found = await api.findUserByEmail(token, customer.email);
      userId = found?.id;
      expect(found?.email.toLowerCase(), 'the customer is found by its exact email').toBe(customer.email.toLowerCase());
      expect(await api.findUserByEmail(token, `nobody-${suffix}@example.test`), 'an email nobody has is no user').toBeUndefined();
    } finally {
      const removals = await Promise.allSettled([
        productId ? api.deleteProduct(token, productId) : Promise.resolve(),
        userId ? api.deleteUser(token, userId) : Promise.resolve(),
      ]);
      await api.deleteBrand(token, brand.id).catch(() => undefined);
      expect(removals.map((r) => r.status), 'the product and the customer were deleted').toEqual(['fulfilled', 'fulfilled']);
    }
    expect(await api.findUserByEmail(token, customer.email), 'the customer is gone').toBeUndefined();
    expect(await api.findProductByName(token, `QaLab Product ${suffix}`), 'the product is gone').toBeUndefined();
    expect((await api.listBrands()).some(({ id }) => id === brand.id), 'the brand is gone').toBe(false);
  });

  test('a read the shop answers with a 5xx is retried, and the retry is annotated on the test', async ({}, testInfo) => {
    const answer = (status: number) => ({ status: () => status, ok: () => status < 400, headers: () => ({}), url: () => 'fake://brands', text: async () => '', json: async () => [] }) as unknown as APIResponse;
    const answers = [answer(500), answer(200)];
    const api = new ToolshopApi({ get: async () => answers.shift() } as unknown as APIRequestContext);
    expect(await api.listBrands(), 'the second answer is the one returned').toEqual([]);
    expect(testInfo.annotations.filter(({ type }) => type === 'api retry'), 'the one retry is on the test').toEqual([{ type: 'api retry', description: 'attempt 1 of 3 failed (answered 500): retried' }]);
  });
});

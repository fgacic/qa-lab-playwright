// The arranging helpers the security and admin specs clean up with (src/support/toolshop-api.ts): create a brand and a product, register
// a customer, find it again by its email, delete all three. Against the self-hosted shop (they write), no browser.
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { apiOnlyTest as test, expect } from '@fixtures';
import { ToolshopApi } from '@support/toolshop-api';
import { fakeCustomer, uniqueEmail } from '@support/test-data';

/** A suffix no other run or worker shares, taken from the same counter and run id as every other unique email (test-data.ts). */
const uniqueSuffix = (): string => uniqueEmail('x').split('@')[0].replace(/\W/g, '');

test.describe('the Toolshop API helpers', { tag: ['@framework', '@self-hosted'] }, () => {
  /** A brand and a product made through the helpers, removed again when the test ends (the product first: it holds the brand). */
  const withProduct = async (api: ToolshopApi, token: string, use: (made: { brand: { id: string }; product: { id: string; name: string } }) => Promise<void>) => {
    const suffix = uniqueSuffix();
    const brand = await api.createBrand(token, { name: `QaLab Brand ${suffix}`, slug: `qalab-${suffix}` });
    let productId: string | undefined;
    try {
      const [category] = await api.categoryTree();
      const product = await api.createProduct(token, {
        name: `QaLab Product ${suffix}`, description: 'made by the framework spec', price: 9.5, category_id: category.id, brand_id: brand.id, product_image_id: await api.firstImageId(),
      });
      productId = product.id;
      await use({ brand, product });
    } finally {
      if (productId) await api.deleteProduct(token, productId).catch(() => undefined);
      await api.deleteBrand(token, brand.id).catch(() => undefined);
    }
  };

  test('a created product is found by its name, and a customer by its exact email', async ({ api, adminToken }) => {
    const token = await adminToken();
    const customer = fakeCustomer();
    await api.registerCustomer(customer);
    const found = await api.findUserByEmail(token, customer.email);
    try {
      await withProduct(api, token, async ({ product }) => {
        expect((await api.findProductByName(token, product.name))?.id, 'the product is in the shop').toBe(product.id);
      });
      expect(found?.email.toLowerCase(), 'the customer is found by its exact email').toBe(customer.email.toLowerCase());
      expect(await api.findUserByEmail(token, `nobody-${uniqueSuffix()}@example.test`), 'an email nobody has is no user').toBeUndefined();
    } finally {
      await api.deleteUser(token, found!.id).catch(() => undefined);
    }
  });

  test('a product, a customer and a brand that are deleted are gone', async ({ api, adminToken }) => {
    const token = await adminToken();
    const customer = fakeCustomer();
    await api.registerCustomer(customer);
    const userId = (await api.findUserByEmail(token, customer.email))!.id;
    let made!: { brand: { id: string }; product: { id: string; name: string } };
    await withProduct(api, token, async (arranged) => {
      made = arranged;
      await api.deleteProduct(token, made.product.id);
      await api.deleteBrand(token, made.brand.id);
    });
    await api.deleteUser(token, userId);
    expect(await api.findUserByEmail(token, customer.email), 'the customer is gone').toBeUndefined();
    expect(await api.findProductByName(token, made.product.name), 'the product is gone').toBeUndefined();
    expect((await api.listBrands()).some(({ id }) => id === made.brand.id), 'the brand is gone').toBe(false);
  });

  test('a read the shop answers with a 5xx is retried, and the retry is annotated on the test', async ({}, testInfo) => {
    const answer = (status: number) => ({ status: () => status, ok: () => status < 400, headers: () => ({}), url: () => 'fake://brands', text: async () => '', json: async () => [] }) as unknown as APIResponse;
    const answers = [answer(500), answer(200)];
    const api = new ToolshopApi({ get: async () => answers.shift() } as unknown as APIRequestContext);
    expect(await api.listBrands(), 'the second answer is the one returned').toEqual([]);
    expect(testInfo.annotations.filter(({ type }) => type === 'api retry'), 'the one retry is on the test').toEqual([{ type: 'api retry', description: 'attempt 1 of 3 failed (answered 500): retried' }]);
  });
});

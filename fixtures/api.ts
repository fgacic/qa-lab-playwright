import { test as base } from '@playwright/test';
import { ToolshopApi, type CartItem, type Product } from '@support/toolshop-api';

/**
 * Products looked up at runtime, once per worker. The shared site's data can change between
 * runs (ids, stock, prices), so nothing in the suite hard-codes a product.
 */
export class Catalog {
  private readonly cache = new Map<string, Promise<Product>>();

  constructor(private readonly api: ToolshopApi) {}

  inStock = () => this.memo('in-stock', () => this.api.inStockProduct());
  anotherInStock = () => this.memo('another-in-stock', async () => this.api.inStockProduct([(await this.inStock()).id]));
  outOfStock = () => this.memo('out-of-stock', () => this.api.outOfStockProduct());
  eco = () => this.memo('eco', () => this.api.ecoProduct());
  nonEco = () => this.memo('non-eco', () => this.api.nonEcoProduct());
  rental = () => this.memo('rental', () => this.api.rentalProduct());

  private memo(key: string, load: () => Promise<Product>): Promise<Product> {
    if (!this.cache.has(key)) this.cache.set(key, load());
    return this.cache.get(key)!;
  }
}

export interface ApiWorkerFixtures {
  api: ToolshopApi;
  catalog: Catalog;
}

export interface ApiFixtures {
  /** Creates a cart through the API and makes the browser tab use it. Returns the cart id. */
  seedCart: (items: CartItem[]) => Promise<string>;
}

export const test = base.extend<ApiFixtures, ApiWorkerFixtures>({
  api: [
    async ({ playwright }, use) => {
      // Ask for JSON: without it Laravel answers a validation error with a 302 redirect, not a 422.
      const request = await playwright.request.newContext({ extraHTTPHeaders: { accept: 'application/json' } });
      await use(new ToolshopApi(request));
      await request.dispose();
    },
    { scope: 'worker' },
  ],
  catalog: [async ({ api }, use) => use(new Catalog(api)), { scope: 'worker' }],
  seedCart: async ({ api, page }, use) => {
    await use(async (items) => {
      const cartId = await api.createCart(items);
      const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
      // The SPA keeps its cart in sessionStorage. Seed it once per tab, so that a cart the
      // app deletes later (after an order) is not brought back on the next navigation.
      await page.addInitScript(
        ({ cartId, quantity }) => {
          if (sessionStorage.getItem('qa-lab-cart-seeded')) return;
          sessionStorage.setItem('qa-lab-cart-seeded', '1');
          sessionStorage.setItem('cart_id', cartId);
          sessionStorage.setItem('cart_quantity', String(quantity));
        },
        { cartId, quantity },
      );
      return cartId;
    });
  },
});

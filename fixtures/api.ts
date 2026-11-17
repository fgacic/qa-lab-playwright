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
  /** A second in-stock product that is neither eco-friendly nor a rental, other than `nonEco`: the two lines of the shared two-product cart. */
  secondNonEco = () =>
    this.memo('second-non-eco', async () => {
      const first = await this.nonEco();
      return this.api.findProduct('second non-eco', (p) => p.in_stock && !p.is_rental && !p.is_eco_friendly && p.id !== first.id);
    });
  rental = () => this.memo('rental', () => this.api.rentalProduct());

  private memo(key: string, load: () => Promise<Product>): Promise<Product> {
    let cached = this.cache.get(key);
    if (!cached) {
      cached = load();
      this.cache.set(key, cached);
      // A failed lookup must not stay cached for the rest of the worker: the next test retries it.
      cached.catch(() => {
        if (this.cache.get(key) === cached) this.cache.delete(key);
      });
    }
    return cached;
  }
}

export interface ApiWorkerFixtures {
  api: ToolshopApi;
  catalog: Catalog;
}

export interface ApiFixtures {
  /** Creates a cart through the API and makes the browser tab use it. Returns the cart id. A tab has one cart, so a second call in a test throws. */
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
    let seeded = false;
    await use(async (items) => {
      // The init script below runs once per tab, so a second cart would silently never be used.
      if (seeded) throw new Error('seedCart was called twice: a browser tab holds one cart, so seed all the items in one call.');
      seeded = true;
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

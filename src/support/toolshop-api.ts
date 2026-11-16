import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { API_URL, IS_SELF_HOSTED } from './env';
import { step } from './step';
import { fakeAddress, type Customer } from './test-data';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  in_stock: boolean;
  is_rental: boolean;
  is_eco_friendly: boolean;
  co2_rating: string;
  brand: { id: string; name: string };
  category: { id: string; name: string; slug: string };
  /** Only GET /products/{id} sends these: a list entry has none. */
  specs: { spec_name: string; spec_value: string; spec_unit: string | null }[];
  product_image: { id: string; title: string; file_name: string; by_name: string; by_url: string; source_name: string; source_url: string };
}

export interface ProductPage {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  data: Product[];
}

export interface CartItem {
  product: Product;
  quantity: number;
}

/** What `createProduct` needs: the fields the shop requires without a default of ours. */
export interface NewProduct {
  name: string;
  description: string;
  price: number;
  category_id: string;
  brand_id: string;
  product_image_id: string;
  is_location_offer?: boolean;
  is_rental?: boolean;
  co2_rating?: string;
}

/** A node of `GET /categories/tree`: a category with its subcategories. */
export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sub_categories: CategoryNode[];
}

/** The product list and search use the HTTP method QUERY with a JSON body. */
export type ProductQuery = Partial<Record<'page' | 'sort' | 'between' | 'by_category' | 'by_brand' | 'eco_friendly' | 'is_rental' | 'by_category_slug', string>>;

/** A ceiling on the catalogue walk: far above any real catalogue, so only a broken pager ever reaches it. */
const MAX_CATALOGUE_PAGES = 100;

/** Writes that leave a persistent, user-visible record (an account, an order, a message) belong on our own shop. */
function assertSelfHosted(what: string, hint = ''): void {
  if (!IS_SELF_HOSTED) throw new Error(`Refusing to ${what} on ${API_URL}: it leaves a real record on a shop that is not self-hosted.${hint ? ` ${hint}` : ''}`);
}

/**
 * Thin client for arranging state through the API (the "arrange through the API, act through
 * the UI" rule). It never asserts on business behaviour: that is the UI specs' job.
 */
export class ToolshopApi {
  constructor(private readonly request: APIRequestContext) {}

  @step('API: list products {0}')
  async listProducts(query: ProductQuery = {}): Promise<ProductPage> {
    const response = await this.read(() =>
      this.request.fetch(`${API_URL}/products`, { method: 'QUERY', data: { page: '1', ...query } }),
    );
    return response.json();
  }

  /** Walks the catalogue page by page until a product matches. Stops early, so usually 1-2 calls. */
  async findProduct(description: string, matches: (p: Product) => boolean, query: ProductQuery = {}): Promise<Product> {
    for (let pageNo = 1; pageNo <= MAX_CATALOGUE_PAGES; pageNo++) {
      const result = await this.listProducts({ ...query, page: String(pageNo) });
      const product = result.data.find(matches);
      if (product) return product;
      // An answer with no usable last_page cannot say when to stop: say so, instead of asking for pages forever.
      if (!Number.isInteger(result.last_page)) throw new Error(`The product list answered without a last_page (page ${pageNo}), so the search for a ${description} product cannot tell where the catalogue ends`);
      if (pageNo >= result.last_page) throw new Error(`No ${description} product in the catalogue right now`);
    }
    throw new Error(`No ${description} product in the first ${MAX_CATALOGUE_PAGES} pages of the catalogue`);
  }

  inStockProduct(exclude: string[] = []) {
    return this.findProduct('in-stock', (p) => p.in_stock && !p.is_rental && !exclude.includes(p.id));
  }

  outOfStockProduct() {
    return this.findProduct('out-of-stock', (p) => !p.in_stock && !p.is_rental);
  }

  ecoProduct() {
    return this.findProduct('eco-friendly', (p) => p.in_stock && p.is_eco_friendly && !p.is_rental, { eco_friendly: 'true' });
  }

  nonEcoProduct() {
    return this.findProduct('non-eco', (p) => p.in_stock && !p.is_eco_friendly && !p.is_rental);
  }

  rentalProduct() {
    return this.findProduct('rental', (p) => p.is_rental, { is_rental: 'true' });
  }

  @step('API: get product {0}')
  async product(id: string): Promise<Product> {
    return (await this.read(() => this.request.get(`${API_URL}/products/${id}`))).json();
  }

  /** Not guarded by assertSelfHosted: a guest cart is anonymous and is how the live run arranges its read flows. */
  @step('API: create a cart')
  async createCart(items: CartItem[]): Promise<string> {
    // Creating a cart is safe to repeat (a failed attempt leaves at most an empty anonymous cart), and
    // POST /carts is the call that answered 500 now and then, so it is retried like a read. Adding the
    // lines is not: a repeated add after a lost answer could double a quantity.
    const { id } = await (await this.send(() => this.request.post(`${API_URL}/carts`, { data: {} }), { idempotent: true })).json();
    for (const { product, quantity } of items) {
      await this.send(() => this.request.post(`${API_URL}/carts/${id}`, { data: { product_id: product.id, quantity } }));
    }
    return id;
  }

  @step('API: register customer {0.email}')
  async registerCustomer(customer: Customer): Promise<void> {
    // Reached by the account setup too: on live with RUN_ACCOUNT_TESTS=1 and no TOOLSHOP_EMAIL / TOOLSHOP_PASSWORD it fails here, before any request.
    assertSelfHosted('register an account', 'To run the account tests on the live site, sign in as an existing customer: set TOOLSHOP_EMAIL and TOOLSHOP_PASSWORD.');
    await this.send(() =>
      this.request.post(`${API_URL}/users/register`, {
        data: {
          first_name: customer.firstName,
          last_name: customer.lastName,
          dob: customer.dateOfBirth,
          phone: customer.phone,
          email: customer.email,
          password: customer.password,
          address: {
            street: customer.address.street,
            city: customer.address.city,
            state: customer.address.state,
            country: customer.address.country,
            postal_code: customer.address.postalCode,
          },
        },
      }),
    );
  }

  @step('API: sign in')
  async login(email: string, password: string): Promise<string> {
    const response = await this.send(() => this.request.post(`${API_URL}/users/login`, { data: { email, password } }));
    const { access_token: token } = await response.json();
    if (typeof token !== 'string' || !token) throw new Error(`${API_URL}/users/login answered ${response.status()} without an access_token`);
    return token;
  }

  @step('API: get the signed-in user')
  async me(token: string): Promise<{ first_name: string; last_name: string; email: string }> {
    return (await this.read(() => this.request.get(`${API_URL}/users/me`, { headers: { authorization: `Bearer ${token}` } }))).json();
  }

  @step('API: category tree')
  async categoryTree(): Promise<CategoryNode[]> {
    return (await this.read(() => this.request.get(`${API_URL}/categories/tree`))).json();
  }

  @step('API: related products of {0}')
  async related(productId: string): Promise<Product[]> {
    return (await this.read(() => this.request.get(`${API_URL}/products/${productId}/related`))).json();
  }

  @step('API: add product {1} to favourites')
  async addFavorite(token: string, productId: string): Promise<void> {
    assertSelfHosted('add a favourite');
    await this.send(() => this.request.post(`${API_URL}/favorites`, { data: { product_id: productId }, headers: { authorization: `Bearer ${token}` } }));
  }

  /** The ids of the products on the account's favourites list, read from the API (the UI could hide one the account still holds). */
  @step('API: list favourites')
  async favoriteProductIds(token: string): Promise<string[]> {
    const response = await this.read(() => this.request.get(`${API_URL}/favorites`, { headers: { authorization: `Bearer ${token}` } }));
    return ((await response.json()) as { product_id: string }[]).map((favourite) => favourite.product_id);
  }

  @step('API: list invoices')
  async invoiceNumbers(token: string): Promise<string[]> {
    const response = await this.read(() => this.request.get(`${API_URL}/invoices`, { headers: { authorization: `Bearer ${token}` } }));
    return ((await response.json()).data as { invoice_number: string }[]).map((i) => i.invoice_number);
  }

  @step('API (admin): delete product {1}')
  async deleteProduct(token: string, productId: string): Promise<void> {
    assertSelfHosted('delete a product');
    await this.send(() => this.request.delete(`${API_URL}/products/${productId}`, { headers: { authorization: `Bearer ${token}` } }));
  }

  /**
   * Creates a product as the admin. The shop requires a category, a brand and an image, so those are the caller's to name
   * (`categoryTree`, `createBrand` and `GET /images` give them); the flags default to a plain, non-rental, non-location product.
   */
  @step('API (admin): create the product {1.name}')
  async createProduct(token: string, product: NewProduct): Promise<{ id: string; name: string }> {
    assertSelfHosted('create a product');
    const data = { is_location_offer: false, is_rental: false, co2_rating: 'A', ...product };
    const response = await this.send(() => this.request.post(`${API_URL}/products`, { data, headers: { authorization: `Bearer ${token}` } }));
    return { name: product.name, id: ((await response.json()) as { id: string }).id };
  }

  /** The id of an image the shop holds, for a product that needs one. */
  @step('API: first product image')
  async firstImageId(): Promise<string> {
    const response = await this.read(() => this.request.get(`${API_URL}/images`));
    const [first] = (await response.json()) as { id: string }[];
    if (!first) throw new Error(`${API_URL}/images listed no image, so a product cannot be created`);
    return first.id;
  }

  @step('API (admin): create the brand {1}')
  async createBrand(token: string, brand: { name: string; slug: string }): Promise<{ id: string; name: string; slug: string }> {
    assertSelfHosted('create a brand');
    const response = await this.send(() => this.request.post(`${API_URL}/brands`, { data: brand, headers: { authorization: `Bearer ${token}` } }));
    return { ...brand, id: ((await response.json()) as { id: string }).id };
  }

  /** Every brand the shop lists (its brand list has no search and is not paged). */
  @step('API: list brands')
  async listBrands(): Promise<{ id: string; name: string; slug: string }[]> {
    const response = await this.read(() => this.request.get(`${API_URL}/brands`));
    return (await response.json()) as { id: string; name: string; slug: string }[];
  }

  @step('API (admin): delete brand {1}')
  async deleteBrand(token: string, brandId: string): Promise<void> {
    assertSelfHosted('delete a brand');
    await this.send(() => this.request.delete(`${API_URL}/brands/${brandId}`, { headers: { authorization: `Bearer ${token}` } }));
  }

  /**
   * The account with exactly this email, as the admin sees it (`GET /users/search` matches names and emails loosely, so the
   * answer is filtered to the exact email), or undefined when there is none. For a cleanup that has only the email.
   */
  @step('API (admin): find the user {1}')
  async findUserByEmail(token: string, email: string): Promise<{ id: string; email: string } | undefined> {
    const response = await this.read(() =>
      this.request.get(`${API_URL}/users/search`, { params: { q: email }, headers: { authorization: `Bearer ${token}` } }),
    );
    return ((await response.json()).data as { id: string; email: string }[]).find((user) => user.email.toLowerCase() === email.toLowerCase());
  }

  @step('API (admin): delete user {1}')
  async deleteUser(token: string, userId: string): Promise<void> {
    assertSelfHosted('delete a user');
    await this.send(() => this.request.delete(`${API_URL}/users/${userId}`, { headers: { authorization: `Bearer ${token}` } }));
  }

  @step('API (admin): find the product named "{1}"')
  async findProductByName(token: string, name: string): Promise<Product | undefined> {
    const response = await this.read(() =>
      this.request.fetch(`${API_URL}/products/search`, { method: 'QUERY', data: { q: name }, headers: { authorization: `Bearer ${token}` } }),
    );
    return ((await response.json()).data as Product[]).find((p) => p.name === name);
  }

  /** A real guest order paid cash on delivery, billed to the address the postcode lookup returns. */
  @step('API: place a guest order')
  async placeGuestOrder(items: CartItem[], guest: { email: string; firstName: string; lastName: string }): Promise<{ invoice_number: string; id: string }> {
    assertSelfHosted('place an order');
    const cartId = await this.createCart(items);
    const address = fakeAddress();
    const lookup = await (await this.read(() => this.request.get(`${API_URL}/postcode-lookup`, { params: { country: address.country, postcode: address.postalCode, house_number: address.houseNumber } }))).json();
    const response = await this.send(() =>
      this.request.post(`${API_URL}/invoices/guest`, {
        data: {
          billing_street: lookup.street, billing_house_number: address.houseNumber, billing_city: lookup.city, billing_state: lookup.state,
          billing_country: address.country, billing_postal_code: address.postalCode, payment_method: 'cash-on-delivery', payment_details: {},
          cart_id: cartId, guest_email: guest.email, guest_first_name: guest.firstName, guest_last_name: guest.lastName,
        },
      }),
    );
    return response.json();
  }

  @step('API: send a contact message')
  async sendContactMessage(message: { name: string; email: string; subject: string; message: string }): Promise<void> {
    assertSelfHosted('send a contact message');
    await this.send(() => this.request.post(`${API_URL}/messages`, { data: message }));
  }

  /** A read: retried on a 5xx or a 429 (see `send`). */
  private read(call: () => Promise<APIResponse>): Promise<APIResponse> {
    return this.send(call, { idempotent: true });
  }

  /**
   * The shared backend fails now and then (POST /carts returned 500 once in three tries while this
   * suite was written), so reads (and the anonymous cart creation) are attempted up to three times (two retries) on a 5xx
   * or a dropped connection, and a 429 once the server's Retry-After has passed. Other writes are never retried: a repeated
   * order or registration could duplicate, so they fail at once, with the response body in the message.
   */
  private async send(call: () => Promise<APIResponse>, { idempotent = false }: { idempotent?: boolean } = {}): Promise<APIResponse> {
    const attempts = idempotent ? 3 : 1;
    let response: APIResponse | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        response = await call();
      } catch (error) {
        // A network error (a reset socket, a refused connection) on a read is as transient as a 5xx; the last attempt rethrows it.
        if (attempt === attempts || !isNetworkError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
      if (attempt === attempts || !(response.status() >= 500 || response.status() === 429)) break;
      const retryAfter = Number(response.headers()['retry-after']);
      const waitMs = response.status() === 429 && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 500 * attempt;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (!response!.ok()) {
      const body = (await response!.text().catch(() => '')).slice(0, 500);
      throw new Error(`${response!.url()} answered ${response!.status()}${body ? `: ${body}` : ''}`);
    }
    return response!;
  }
}

/** A failure of the connection itself (not a closed context or a test timeout, which must stay failures). */
function isNetworkError(error: unknown): boolean {
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|network/i.test(String((error as Error)?.message ?? error));
}

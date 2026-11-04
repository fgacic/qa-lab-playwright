import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { API_URL } from './env';
import { step } from './step';
import type { Customer } from './test-data';

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

/** The product list and search use the HTTP method QUERY with a JSON body. */
export type ProductQuery = Partial<Record<'page' | 'sort' | 'between' | 'by_category' | 'by_brand' | 'eco_friendly' | 'is_rental' | 'by_category_slug', string>>;

/**
 * Thin client for arranging state through the API (the "arrange through the API, act through
 * the UI" rule). It never asserts on business behaviour: that is the UI specs' job.
 */
export class ToolshopApi {
  constructor(private readonly request: APIRequestContext) {}

  @step('API: list products {0}')
  async listProducts(query: ProductQuery = {}): Promise<ProductPage> {
    const response = await this.send(() =>
      this.request.fetch(`${API_URL}/products`, { method: 'QUERY', data: { page: '1', ...query } }),
    );
    return response.json();
  }

  /** Walks the catalogue page by page until a product matches. Stops early, so usually 1-2 calls. */
  async findProduct(description: string, matches: (p: Product) => boolean, query: ProductQuery = {}): Promise<Product> {
    for (let pageNo = 1; ; pageNo++) {
      const result = await this.listProducts({ ...query, page: String(pageNo) });
      const product = result.data.find(matches);
      if (product) return product;
      if (pageNo >= result.last_page) throw new Error(`No ${description} product in the catalogue right now`);
    }
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
    return (await this.send(() => this.request.get(`${API_URL}/products/${id}`))).json();
  }

  @step('API: create a cart')
  async createCart(items: CartItem[]): Promise<string> {
    const { id } = await (await this.send(() => this.request.post(`${API_URL}/carts`, { data: {} }))).json();
    for (const { product, quantity } of items) {
      await this.send(() => this.request.post(`${API_URL}/carts/${id}`, { data: { product_id: product.id, quantity } }));
    }
    return id;
  }

  @step('API: register customer {0.email}')
  async registerCustomer(customer: Customer): Promise<void> {
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
    return (await response.json()).access_token;
  }

  @step('API: add product {1} to favourites')
  async addFavorite(token: string, productId: string): Promise<void> {
    await this.send(() => this.request.post(`${API_URL}/favorites`, { data: { product_id: productId }, headers: { authorization: `Bearer ${token}` } }));
  }

  @step('API: list invoices')
  async invoiceNumbers(token: string): Promise<string[]> {
    const response = await this.send(() => this.request.get(`${API_URL}/invoices`, { headers: { authorization: `Bearer ${token}` } }));
    return ((await response.json()).data as { invoice_number: string }[]).map((i) => i.invoice_number);
  }

  @step('API (admin): delete product {1}')
  async deleteProduct(token: string, productId: string): Promise<void> {
    await this.send(() => this.request.delete(`${API_URL}/products/${productId}`, { headers: { authorization: `Bearer ${token}` } }));
  }

  @step('API (admin): find the product named "{1}"')
  async findProductByName(token: string, name: string): Promise<Product | undefined> {
    const response = await this.send(() =>
      this.request.fetch(`${API_URL}/products/search`, { method: 'QUERY', data: { q: name }, headers: { authorization: `Bearer ${token}` } }),
    );
    return ((await response.json()).data as Product[]).find((p) => p.name === name);
  }

  /** A real guest order paid cash on delivery, billed to the address the postcode lookup returns. */
  @step('API: place a guest order')
  async placeGuestOrder(items: CartItem[], guest: { email: string; firstName: string; lastName: string }): Promise<{ invoice_number: string; id: string }> {
    const cartId = await this.createCart(items);
    const lookup = await (await this.send(() => this.request.get(`${API_URL}/postcode-lookup`, { params: { country: 'NL', postcode: '1234 AB', house_number: '1' } }))).json();
    const response = await this.send(() =>
      this.request.post(`${API_URL}/invoices/guest`, {
        data: {
          billing_street: lookup.street, billing_house_number: '1', billing_city: lookup.city, billing_state: lookup.state,
          billing_country: 'NL', billing_postal_code: '1234 AB', payment_method: 'cash-on-delivery', payment_details: {},
          cart_id: cartId, guest_email: guest.email, guest_first_name: guest.firstName, guest_last_name: guest.lastName,
        },
      }),
    );
    return response.json();
  }

  @step('API: send a contact message')
  async sendContactMessage(message: { name: string; email: string; subject: string; message: string }): Promise<void> {
    await this.send(() => this.request.post(`${API_URL}/messages`, { data: message }));
  }

  /**
   * Arrange calls retry a 5xx up to three times: the shared backend fails now and then
   * (POST /carts returned 500 once in three tries while this suite was written), and a
   * flaky precondition should not fail a test about something else.
   */
  private async send(call: () => Promise<APIResponse>): Promise<APIResponse> {
    let response = await call();
    for (let attempt = 1; attempt < 3 && response.status() >= 500; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      response = await call();
    }
    expect(response, `${response.url()} answered ${response.status()}`).toBeOK();
    return response;
  }
}

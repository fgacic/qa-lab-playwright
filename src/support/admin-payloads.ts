import type { HttpMethod } from './api-mock';
import type { Product } from './toolshop-api';

/**
 * Response bodies for the admin endpoints, shaped after the API's OpenAPI document
 * (https://api.practicesoftwaretesting.com/api/documentation). Every record is invented:
 * the names say so ("Qa Lab ..."), emails are on example.com.
 */
export const paginated = <T>(data: T[], perPage = 15, { page = 1, lastPage = 1 } = {}) => ({
  current_page: page,
  data,
  from: data.length ? 1 : null,
  last_page: lastPage,
  per_page: perPage,
  to: data.length || null,
  total: data.length,
});

export const adminUser = {
  id: '01QALABADMIN0000000000000',
  first_name: 'Admin',
  last_name: 'McTestface',
  email: 'admin.mctestface@example.com',
  role: 'admin',
};

export const customer = {
  id: '01QALABCUSTOMER0000000000',
  first_name: 'Testy',
  last_name: 'McTestface',
  email: 'testy.mctestface@example.com',
  phone: '0123456789',
  dob: '1990-01-01',
  address: { street: 'Test Street 1', city: 'Testville', state: 'Teststate', country: 'NL', postal_code: '1234 AB' },
  provider: null,
  totp_enabled: false,
  enabled: true,
  failed_login_attempts: 0,
  created_at: '2026-11-01 10:00:00',
};

export const brand = { id: '01QALABBRAND0000000000000', name: 'Qa Lab Tools', slug: 'qa-lab-tools' };

export const category = { id: '01QALABCATEGORY0000000000', parent_id: null, name: 'Qa Lab Category', slug: 'qa-lab-category', sub_categories: [] };

/** A category under `category`: what the edit form must show as its parent, and send back as `parent_id`. */
export const subcategory = { id: '01QALABSUBCATEGORY000000000', parent_id: category.id, name: 'Qa Lab Subcategory', slug: 'qa-lab-subcategory', sub_categories: [] };

/**
 * The one product the mocked back office serves: fixed, so a spec never depends on what the shop's
 * catalogue holds today, and it carries the mocked brand and category the edit form can select.
 */
export const product: Product = {
  id: '01QALABPRODUCT0000000000',
  name: 'Qa Lab Combination Pliers',
  description: 'A mocked product for the back office.',
  specs: [],
  price: 14.15,
  in_stock: true,
  is_rental: false,
  is_eco_friendly: false,
  co2_rating: 'B',
  brand: { id: brand.id, name: brand.name },
  category: { id: category.id, name: category.name, slug: category.slug },
  product_image: { id: '01QALABIMAGE00000000000000', title: 'Qa Lab Pliers', file_name: 'pliers01.avif', by_name: 'Qa Lab', by_url: 'https://example.com', source_name: 'Qa Lab', source_url: 'https://example.com' },
};

/** The one specification the mocked product carries: what its edit form lists, and what a removal of it targets. */
export const spec = { id: '01QALABSPEC00000000000000', product_id: product.id, spec_name: 'Weight', spec_value: '340', spec_unit: 'g' };

/** A price as the back office draws it: dollars, two decimals. */
export const dollars = (amount: number): string => `$${amount.toFixed(2)}`;

/** A record the mocked search answers with: not in the full list, so a table that shows it has really been replaced. */
export const SEARCH_HIT = 'Qa Lab Search Hit';

/** The payment of the mocked order: the API's method code and the label the order page shows for it. */
export const orderPayment = { method: 'cash-on-delivery', label: 'Cash on Delivery' };

/** The one line of the mocked order: fixed numbers, so no spec computes its expectation with the arithmetic it checks. */
export const orderLine = { unitPrice: 9.99, quantity: 2, total: 19.98 };

/** The status the mocked order has, and the one a status picker does not offer again. */
export const ORDER_STATUS = 'AWAITING_FULFILLMENT';

export const order = (product: Product) => ({
  id: '01QALABORDER0000000000000',
  user_id: customer.id,
  invoice_date: '2026-11-01 10:00:00',
  invoice_number: 'INV-2026999998',
  billing_street: 'Test Street 1',
  billing_city: 'Testville',
  billing_state: 'Teststate',
  billing_country: 'NL',
  billing_postal_code: '1234 AB',
  additional_discount_percentage: null,
  additional_discount_amount: null,
  subtotal: orderLine.total,
  total: orderLine.total,
  status: ORDER_STATUS,
  status_message: null,
  created_at: '2026-11-01 10:00:00',
  payment: { id: '01QALABPAYMENT', payment_method: orderPayment.method, payment_details: {} },
  user: customer,
  invoicelines: [
    { id: '01QALABLINE0', invoice_id: '01QALABORDER0000000000000', product_id: product.id, unit_price: orderLine.unitPrice, discount_percentage: null, discounted_price: null, quantity: orderLine.quantity, product: { ...product, price: orderLine.unitPrice } },
  ],
});

export const contactMessage = {
  id: '01QALABADMINMESSAGE000000',
  name: 'Testy McTestface',
  email: customer.email,
  subject: 'return',
  message: 'A mocked contact message for the admin inbox, long enough to look real.',
  status: 'NEW',
  created_at: '2026-11-01 10:00:00',
  user: customer,
  replies: [],
};

/** An answer of an admin the message detail shows as a card under "Replies": the author's name, then the text. */
export const messageReply = (text: string) => ({
  id: '01QALABREPLY0000000000000',
  message: text,
  message_id: contactMessage.id,
  user_id: adminUser.id,
  created_at: '2026-11-02 09:00:00',
  user: adminUser,
});

export const reports = {
  totalSalesOfYears: [{ year: 2025, total: 1234.5 }, { year: 2026, total: 2345.75 }],
  bestSellingCategories: [{ category_name: 'Qa Lab Category', total_earned: '1234' }],
  purchasedProducts: [{ name: 'Qa Lab Hammer', count: 12 }],
  customersByCountry: [{ country: 'The Netherlands', amount: 7 }],
  salesPerCountry: [{ billing_country: 'The Netherlands', total_sales: '4321' }],
  averageSalesPerMonth: [{ month: 1, average: 2.5, amount: 120.5 }, { month: 2, average: 3, amount: 150 }],
  averageSalesPerWeek: [{ week: 1, average: 1.5, amount: 40 }, { week: 2, average: 2, amount: 55.5 }],
};

export const updated = { success: true };

/**
 * What each back-office list is fed by, how its search box asks, and an empty answer for both (the messages list has no
 * search). `column` is a column title that stays on screen when the answer is empty.
 */
export const LIST_ANSWERS = {
  products: { feed: ['QUERY', '/products'], search: ['QUERY', '/products/search'], empty: paginated([], 9), column: 'Price' },
  brands: { feed: ['GET', '/brands'], search: ['QUERY', '/brands/search'], empty: [], column: 'Slug' },
  categories: { feed: ['GET', '/categories'], search: ['QUERY', '/categories/search'], empty: [], column: 'Slug' },
  orders: { feed: ['GET', '/invoices'], search: ['QUERY', '/invoices/search'], empty: paginated([]), column: 'Total' },
  users: { feed: ['GET', '/users'], search: ['QUERY', '/users/search'], empty: paginated([]), column: 'Email' },
  messages: { feed: ['GET', '/messages'], empty: paginated([]), column: 'Subject' },
} as const satisfies Record<string, { feed: readonly [HttpMethod, string]; search?: readonly [HttpMethod, string]; empty: unknown; column: string }>;

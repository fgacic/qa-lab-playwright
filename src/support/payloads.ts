import type { Product } from './toolshop-api';

/**
 * Response bodies for mocked endpoints, shaped like the real API. Keeping them here
 * means one place to update if the contract changes, and mocks that stay realistic.
 */
export const emptyProductPage = () => ({
  current_page: 1,
  data: [],
  from: null,
  last_page: 1,
  per_page: 9,
  to: null,
  total: 0,
});

export const serverError = { message: 'Server Error' };

export const fakeUser = {
  id: '01QALABFAKEUSER0000000000',
  first_name: 'Testy',
  last_name: 'McTestface',
  email: 'testy.mctestface@example.com',
  phone: '0123456789',
  dob: '1990-01-01',
  address: { street: 'Test Street 1', city: 'Testville', state: 'Teststate', country: 'NL', postal_code: '1234 AB' },
};

export const fakeFavorite = (product: Product) => ({
  id: '01QALABFAKEFAVORITE000000',
  user_id: fakeUser.id,
  product_id: product.id,
  product,
});

export const fakeInvoice = (product: Product) => ({
  id: '01QALABFAKEINVOICE0000000',
  invoice_number: 'INV-2026999999',
  invoice_date: '2026-11-01 10:00:00',
  billing_street: 'Test Street 1',
  billing_city: 'Testville',
  billing_state: 'Teststate',
  billing_country: 'NL',
  billing_postal_code: '1234 AB',
  subtotal: product.price * 2,
  total: product.price * 2,
  status: 'AWAITING_FULFILLMENT',
  payment: { payment_method: 'cash-on-delivery', payment_details: {} },
  invoicelines: [{ id: '01QALABFAKELINE', quantity: 2, unit_price: product.price, product }],
});

export const fakeMessage = {
  id: '01QALABFAKEMESSAGE0000000',
  name: 'Testy McTestface',
  email: fakeUser.email,
  subject: 'webmaster',
  message: 'A mocked message, long enough to be a plausible contact form message.',
  status: 'NEW',
  created_at: '2026-11-01 10:00:00',
  replies: [],
};

export const page = <T>(data: T[]) => ({
  current_page: 1,
  data,
  from: data.length ? 1 : null,
  last_page: 1,
  per_page: 15,
  to: data.length || null,
  total: data.length,
});

/** An unsigned JWT the SPA accepts: it only decodes the payload for `role` and `exp`. */
export function fakeJwt(role: 'user' | 'admin' = 'user'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: fakeUser.id, role, iat: now, exp: now + 3600 })}.qa-lab-unsigned`;
}

export interface SaleEvent {
  name: string;
  quantity: number;
  unit_price: number;
  buyer: string;
  city: string;
  sold_out?: boolean;
}

/** A finite Server-Sent Events body for GET /sales-stream. */
export function salesStream(sales: SaleEvent[]): string {
  const events = sales.map((sale, i) => {
    const amount = Math.round(sale.unit_price * sale.quantity * 100) / 100;
    const data = { seq: i + 1, at: '2026-11-03T20:00:00+00:00', product_id: `01QALABSALE${i}`, amount, remaining_stock: sale.sold_out ? 0 : 10, sold_out: false, ...sale };
    return `id: ${i + 1}\nevent: sale\ndata: ${JSON.stringify(data)}\n\n`;
  });
  return `retry: 600000\n\nid: 0\nevent: open\ndata: {"limit":${sales.length}}\n\n${events.join('')}`;
}

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

export const FAVORITE_ID = '01QALABFAKEFAVORITE000000';

export const fakeFavorite = (product: Product) => ({
  id: FAVORITE_ID,
  user_id: fakeUser.id,
  product_id: product.id,
  product,
});

export const INVOICE_NUMBER = 'INV-2026999999';
/** How many units the mocked invoice's single line holds. */
export const INVOICE_QUANTITY = 2;

export const fakeInvoice = (product: Product) => ({
  id: '01QALABFAKEINVOICE0000000',
  invoice_number: INVOICE_NUMBER,
  invoice_date: '2026-11-01 10:00:00',
  billing_street: 'Test Street 1',
  billing_city: 'Testville',
  billing_state: 'Teststate',
  billing_country: 'NL',
  billing_postal_code: '1234 AB',
  subtotal: product.price * INVOICE_QUANTITY,
  total: product.price * INVOICE_QUANTITY,
  status: 'AWAITING_FULFILLMENT',
  payment: { payment_method: 'cash-on-delivery', payment_details: {} },
  invoicelines: [{ id: '01QALABFAKELINE', quantity: INVOICE_QUANTITY, unit_price: product.price, product }],
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

/** What POST /messages answers once it has stored a message. */
export const acceptedMessage = { id: fakeMessage.id, status: fakeMessage.status };

/** A page of a paginated list, as the API wraps it. */
export const listOf = <T>(data: T[]) => ({
  current_page: 1,
  data,
  from: data.length ? 1 : null,
  last_page: 1,
  per_page: 15,
  to: data.length || null,
  total: data.length,
});

/** A password for mocked sign-ins: it matches no real account and is sent nowhere real. */
export const MOCKED_PASSWORD = 'Qa-lab-mocked-1!';

/** Credentials no account holds, for the real refusal and its mocked twin. */
export const UNKNOWN_EMAIL = 'nobody@example.invalid';
export const UNKNOWN_PASSWORD = 'not-a-real-password';

/** An unsigned JWT the SPA accepts: it only decodes the payload for `role` and `exp`. */
export function fakeJwt(role: 'user' | 'admin' = 'user'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: fakeUser.id, role, iat: now, exp: now + 3600 })}.qa-lab-unsigned`;
}

/** When a JWT stops being valid, in epoch seconds: the counterpart of `fakeJwt`, for any token the SPA stores. */
export function jwtExpiry(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number };
  if (typeof payload.exp !== 'number') throw new Error('The token has no numeric "exp" claim.');
  return payload.exp;
}

/** The contact form's subjects: the label shown in the dropdown and the slug the API stores. */
export const CONTACT_SUBJECTS = [
  { label: 'Customer service', slug: 'customer-service' },
  { label: 'Webmaster', slug: 'webmaster' },
  { label: 'Return', slug: 'return' },
  { label: 'Payments', slug: 'payments' },
  { label: 'Warranty', slug: 'warranty' },
  { label: 'Status of my order', slug: 'status-of-order' },
] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]['label'];

export const contactSubjectSlug = (label: ContactSubject): string => CONTACT_SUBJECTS.find((subject) => subject.label === label)!.slug;

export interface SaleEvent {
  name: string;
  quantity: number;
  unit_price: number;
  buyer: string;
  city: string;
  sold_out?: boolean;
}

/**
 * A finite Server-Sent Events body for GET /sales-stream. When the body ends the browser reconnects after `retryMs`
 * (the default is long enough that a test never sees it; a short one makes a dropped connection reconnect at once).
 */
export function salesStream(sales: SaleEvent[], retryMs = 600_000): string {
  const events = sales.map((sale, i) => {
    const amount = Math.round(sale.unit_price * sale.quantity * 100) / 100;
    const data = { seq: i + 1, at: '2026-11-03T20:00:00+00:00', product_id: `01QALABSALE${i}`, amount, remaining_stock: sale.sold_out ? 0 : 10, sold_out: false, ...sale };
    return `id: ${i + 1}\nevent: sale\ndata: ${JSON.stringify(data)}\n\n`;
  });
  return `retry: ${retryMs}\n\nid: 0\nevent: open\ndata: {"limit":${sales.length}}\n\n${events.join('')}`;
}

/** A sale as the live feed carries it; override what a test cares about. */
export const fakeSale = (overrides: Partial<SaleEvent> = {}): SaleEvent => ({
  name: 'Qa Lab Hammer',
  quantity: 1,
  unit_price: 10.5,
  buyer: 'Testy',
  city: 'Testville',
  ...overrides,
});

/** A reply to a contact message, as GET /messages/:id lists it. */
export const fakeReply = (message: string) => ({
  id: '01QALABFAKEREPLY',
  message,
  user_id: fakeUser.id,
  created_at: '2026-11-01 11:00:00',
  user: { first_name: fakeUser.first_name, last_name: fakeUser.last_name },
});

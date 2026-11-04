import type { Product } from './toolshop-api';

/**
 * Response bodies for the admin endpoints, shaped after the API's OpenAPI document
 * (https://api.practicesoftwaretesting.com/api/documentation). Every record is invented:
 * the names say so ("Qa Lab ..."), emails are on example.com.
 */
export const paginated = <T>(data: T[], perPage = 15) => ({
  current_page: 1,
  data,
  from: data.length ? 1 : null,
  last_page: 1,
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
  subtotal: product.price * 2,
  total: product.price * 2,
  status: 'AWAITING_FULFILLMENT',
  status_message: null,
  created_at: '2026-11-01 10:00:00',
  payment: { id: '01QALABPAYMENT', payment_method: 'cash-on-delivery', payment_details: {} },
  user: customer,
  invoicelines: [
    { id: '01QALABLINE0', invoice_id: '01QALABORDER0000000000000', product_id: product.id, unit_price: product.price, discount_percentage: null, discounted_price: null, quantity: 2, product },
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

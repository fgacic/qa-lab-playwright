export const API_URL = process.env.API_URL ?? 'https://api.practicesoftwaretesting.com';

/** Specs that create real accounts or sign in for real only run when this is set (see README). */
export const RUN_ACCOUNT_TESTS = process.env.RUN_ACCOUNT_TESTS === '1';
export const ACCOUNT_SKIP_REASON =
  'Creates or signs in to a real account on the public shop. Set RUN_ACCOUNT_TESTS=1 to run.';

/** Where the account setup project saves the signed-in session (gitignored). */
export const CUSTOMER_STORAGE_STATE = '.auth/customer.json';

/** Real back-office journeys only run with this set, signed in as ADMIN_EMAIL / ADMIN_PASSWORD. */
export const RUN_ADMIN_TESTS = process.env.RUN_ADMIN_TESTS === '1';
export const ADMIN_SKIP_REASON =
  'Signs in as an admin and changes data on the public shop. Set RUN_ADMIN_TESTS=1 (and ADMIN_EMAIL / ADMIN_PASSWORD) to run.';
export const ADMIN_STORAGE_STATE = '.auth/admin.json';

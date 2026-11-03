export const API_URL = process.env.API_URL ?? 'https://api.practicesoftwaretesting.com';

/** Specs that create real accounts or sign in for real only run when this is set (see README). */
export const RUN_ACCOUNT_TESTS = process.env.RUN_ACCOUNT_TESTS === '1';
export const ACCOUNT_SKIP_REASON =
  'Creates or signs in to a real account on the public shop. Set RUN_ACCOUNT_TESTS=1 to run.';

/** Where the account setup project saves the signed-in session (gitignored). */
export const CUSTOMER_STORAGE_STATE = '.auth/customer.json';

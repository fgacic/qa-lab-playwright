/**
 * Where the suite runs. Two targets:
 * - `local` (the default, and what CI gates on): the self-hosted Toolshop from docker-compose.yml,
 *   pinned to tag 2.5 and seeded fresh. It is ours, so specs may register accounts, sign in with
 *   the seeded accounts (admin included), and submit attack payloads.
 * - `live`: the public practicesoftwaretesting.com. Shared with everyone, so real accounts, real
 *   sign-ins and submitted payloads stay off unless explicitly enabled, and workers stay at two.
 * BASE_URL / API_URL override either target's addresses.
 */
export type Target = 'local' | 'live';
export const TARGET: Target = process.env.TARGET === 'live' ? 'live' : 'local';
export const IS_SELF_HOSTED = TARGET === 'local';

const ADDRESSES: Record<Target, { base: string; api: string }> = {
  local: { base: 'http://localhost:4200', api: 'http://localhost:4200/api' },
  live: { base: 'https://practicesoftwaretesting.com', api: 'https://api.practicesoftwaretesting.com' },
};
export const BASE_URL = process.env.BASE_URL ?? ADDRESSES[TARGET].base;
export const API_URL = process.env.API_URL ?? ADDRESSES[TARGET].api;

/**
 * Accounts the self-hosted shop is seeded with (database/seeders/UserSeeder.php at tag 2.5).
 * Test values of our own environment, never used against the live site.
 */
const SEEDED = {
  admin: { email: 'admin@practicesoftwaretesting.com', password: 'welcome01' },
};

/** Real-account specs: always on the self-hosted target, opt-in (RUN_ACCOUNT_TESTS=1) on live. */
export const RUN_ACCOUNT_TESTS = IS_SELF_HOSTED || process.env.RUN_ACCOUNT_TESTS === '1';
export const ACCOUNT_SKIP_REASON =
  'Creates or signs in to a real account on the public shop. Set RUN_ACCOUNT_TESTS=1 to run on live.';
export const CUSTOMER_STORAGE_STATE = '.auth/customer.json';
/** An existing customer to sign in as. Unset, the account setup registers a fresh one. */
export const CUSTOMER_CREDENTIALS = {
  email: process.env.TOOLSHOP_EMAIL,
  password: process.env.TOOLSHOP_PASSWORD,
};

/** Real back-office journeys: always on the self-hosted target, opt-in (RUN_ADMIN_TESTS=1) on live. */
export const RUN_ADMIN_TESTS = IS_SELF_HOSTED || process.env.RUN_ADMIN_TESTS === '1';
export const ADMIN_SKIP_REASON =
  'Signs in as an admin and changes data on the public shop. Set RUN_ADMIN_TESTS=1 with ADMIN_EMAIL / ADMIN_PASSWORD to run on live.';
export const ADMIN_STORAGE_STATE = '.auth/admin.json';
export const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL ?? (IS_SELF_HOSTED ? SEEDED.admin.email : undefined),
  password: process.env.ADMIN_PASSWORD ?? (IS_SELF_HOSTED ? SEEDED.admin.password : undefined),
};

/** Specs that submit attack payloads, measure performance or compare screenshots: ours only. */
export const SELF_HOSTED_ONLY = 'Runs only against the self-hosted Toolshop (TARGET=local), never the public site.';

/**
 * The API path of a request URL, without the API's own prefix: "/products" both for
 * https://api.practicesoftwaretesting.com/products and for http://localhost:4200/api/products.
 */
export function apiPath(url: string): string {
  const prefix = new URL(API_URL).pathname.replace(/\/$/, '');
  const { pathname } = new URL(url);
  return prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || '/' : pathname;
}

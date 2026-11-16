import seeded from './seeded-accounts.json';

/**
 * Where the suite runs. Two targets:
 * - `local` (the default, and what CI gates on): the self-hosted Toolshop from docker-compose.yml,
 *   built from the commit in .env.toolshop and seeded fresh. It is ours, so specs may register accounts, sign in with
 *   the seeded accounts (admin included), and submit attack payloads.
 * - `live`: the public practicesoftwaretesting.com. Shared with everyone, so real accounts, real
 *   sign-ins and submitted payloads stay off unless explicitly enabled, and workers stay at two.
 * BASE_URL / API_URL override either target's addresses.
 */
export type Target = 'local' | 'live';
const requestedTarget = process.env.TARGET || 'local';
// A typo such as TARGET=prod must not quietly run the suite (and its writes) against the default.
if (requestedTarget !== 'local' && requestedTarget !== 'live') {
  throw new Error(`Unknown TARGET "${requestedTarget}": use "local" (the default, the self-hosted Toolshop) or "live".`);
}
export const TARGET: Target = requestedTarget;
const ADDRESSES: Record<Target, { base: string; api: string }> = {
  local: { base: 'http://localhost:4200', api: 'http://localhost:4200/api' },
  live: { base: 'https://practicesoftwaretesting.com', api: 'https://api.practicesoftwaretesting.com' },
};
export const BASE_URL = process.env.BASE_URL || ADDRESSES[TARGET].base;
// No trailing slash: ApiMock's `isApiUrl` and `apiPath` match on `API_URL + '/'`, so "http://host/api/" would match nothing.
export const API_URL = (process.env.API_URL || ADDRESSES[TARGET].api).replace(/\/+$/, '');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal']);
const isLocalHost = (url: string) => LOCAL_HOSTS.has(new URL(url).hostname);

// Self-hosted means the target says so AND both resolved addresses are ours: a BASE_URL or
// API_URL override can never turn the live site into a target that may register accounts,
// sign in as the admin or submit attack payloads.
if (TARGET === 'local' && !(isLocalHost(BASE_URL) && isLocalHost(API_URL))) {
  throw new Error(
    `TARGET=local (the default) runs real sign-ins, the seeded admin and attack payloads, but BASE_URL=${BASE_URL} / API_URL=${API_URL} are not local. ` +
      'Point both at the self-hosted Toolshop, or set TARGET=live to run the live-safe subset.',
  );
}
// The self-hosted Toolshop serves the SPA and the API from one origin (nginx proxies /api). Anything else is a
// misconfiguration that would send the shop's own calls to a different server than the one under test.
if (TARGET === 'local' && new URL(BASE_URL).origin !== new URL(API_URL).origin) {
  throw new Error(`TARGET=local expects BASE_URL (${BASE_URL}) and API_URL (${API_URL}) on the same origin: the self-hosted shop serves both. Fix the override, or use TARGET=live.`);
}
export const IS_SELF_HOSTED = TARGET === 'local' && isLocalHost(BASE_URL) && isLocalHost(API_URL);

/**
 * Accounts the self-hosted shop is seeded with (database/seeders/UserSeeder.php at the commit in .env.toolshop).
 * Test values of our own environment, never used against the live site.
 */
// In a JSON file so scripts/wait-for-toolshop.mjs reads the very same values.
const SEEDED = seeded;

/**
 * Names of the projects that sign in and write for real, shared by playwright.config.ts (which declares
 * them) and fixtures/mocks.ts (whose live-site write guard must not apply to them).
 */
export const PROJECTS = { accountSetup: 'account-setup', account: 'account', adminSetup: 'admin-setup', admin: 'admin' } as const;
export const REAL_WRITE_PROJECTS: ReadonlySet<string> = new Set(Object.values(PROJECTS));

/** Real-account specs: always on the self-hosted target, opt-in (RUN_ACCOUNT_TESTS=1) on live. */
export const RUN_ACCOUNT_TESTS = IS_SELF_HOSTED || process.env.RUN_ACCOUNT_TESTS === '1';
export const CUSTOMER_STORAGE_STATE = '.auth/customer.json';
/** An existing customer to sign in as. Unset, the account setup registers a fresh one. */
export const CUSTOMER_CREDENTIALS = {
  email: process.env.TOOLSHOP_EMAIL,
  password: process.env.TOOLSHOP_PASSWORD,
};

/** Real back-office journeys: always on the self-hosted target, opt-in (RUN_ADMIN_TESTS=1) on live. */
export const RUN_ADMIN_TESTS = IS_SELF_HOSTED || process.env.RUN_ADMIN_TESTS === '1';
export const ADMIN_STORAGE_STATE = '.auth/admin.json';
export const ADMIN_CREDENTIALS = {
  email: process.env.ADMIN_EMAIL || (IS_SELF_HOSTED ? SEEDED.admin.email : undefined),
  password: process.env.ADMIN_PASSWORD || (IS_SELF_HOSTED ? SEEDED.admin.password : undefined),
};

/**
 * The API path of a request URL, without the API's own prefix: "/products" both for
 * https://api.practicesoftwaretesting.com/products and for http://localhost:4200/api/products.
 */
export function apiPath(url: string): string {
  const prefix = new URL(API_URL).pathname.replace(/\/$/, '');
  const { pathname } = new URL(url);
  return prefix && (pathname === prefix || pathname.startsWith(`${prefix}/`)) ? pathname.slice(prefix.length) || '/' : pathname;
}

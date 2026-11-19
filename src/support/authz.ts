import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { Cleanups } from '@fixtures/cleanups';
import { API_URL } from '@support/env';
import { fakeCustomer, uniqueEmail, type Customer } from '@support/test-data';
import type { Product, ToolshopApi } from '@support/toolshop-api';

/**
 * What the API-level security specs (tests/security/authorization-*, cart-access, login-lockout) share: one authenticated-or-not call,
 * the statuses that count as a refusal, and the accounts and removals a test arranges. Every helper here writes to the shop's database,
 * so the specs that use them are `@self-hosted`.
 *
 * The conventions of the whole authorisation suite (authorization-catalogue, -reads, -records, -tokens), stated once here:
 *
 * A page only hides a button, the API is what enforces, so these are plain HTTP calls with no token, with a customer's token and with the admin's.
 * They write to our own database and try to read other people's data, so they only ever run against the self-hosted Toolshop (@self-hosted).
 * No browser is involved (`apiOnlyTest`), so each file is tagged @api and scheduled once (in Chromium) instead of once per browser.
 *
 * Verdicts: a call is refused by 401 (no valid token) or 403 (a token that may not), and a record that belongs to somebody else is
 * hidden by a 403 or a 404: all of those count as "refused". A success (2xx) is "accepted". Any other answer (a 404 on a
 * route that should exist, a 405, a 500) is neither: it says nothing about authorisation, so it fails the test without
 * naming a defect id. Every "refused" check that tolerates a 404 comes after a control in which the admin gets a 200 from the
 * same path, so a typo in a path cannot pass as a refusal.
 *
 * Cleanup: what each test makes, it removes again, pass or fail, in reverse order: the records the admin API can delete (brands,
 * categories, products, the customers a test registers, the favourites that would block deleting them). Two kinds are left
 * behind on purpose, all uniquely named and harmless on the throwaway database of the self-hosted target, which is rebuilt
 * for every CI run: guest orders (DELETE /invoices/{id} answers 405) and contact messages (DELETE /messages/{id} answers 405).
 * No seeded record is ever changed: every write is aimed at a record the test made.
 */


/** A call is refused by 401 (no valid token) or 403 (a token that may not). */
export const REFUSED = [401, 403];
/** A record that belongs to somebody else may also be hidden, by a 404. */
export const REFUSED_OR_HIDDEN = [401, 403, 404];

/** One authenticated-or-not call to the API, asking for JSON (without it Laravel redirects a validation error). */
export function call(request: APIRequestContext, method: string, path: string, { token, data }: { token?: string; data?: object } = {}): Promise<APIResponse> {
  return request.fetch(`${API_URL}${path}`, { method, data, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
}

/** What a test needs to arrange: the page-less request context, the API client, the admin's token and the list of removals. */
export interface World {
  request: APIRequestContext;
  api: ToolshopApi;
  adminToken: () => Promise<string>;
  cleanups: Cleanups;
}

/** Removes a record by its path through the admin's token, after the test; a record already gone is fine. */
export const removeLater = ({ request, adminToken, cleanups }: World, path: string) =>
  cleanups.push(async () => {
    const response = await call(request, 'DELETE', path, { token: await adminToken() });
    if (!response.ok() && response.status() !== 404) throw new Error(`DELETE ${path} answered ${response.status()}`);
  });

/**
 * Removes every favourite the owner holds, once the test is over (cleanups run last made first, so this runs before the owner's own
 * removal): an account that still has favourites cannot be deleted.
 */
export const removeFavouritesLater = ({ request, cleanups }: World, owner: Pick<Account, 'token'>) =>
  cleanups.push(async () => {
    for (const { id } of (await (await call(request, 'GET', '/favorites', { token: owner.token })).json()) as { id: string }[]) await call(request, 'DELETE', `/favorites/${id}`, { token: owner.token });
  });

/** A customer registered for this test and signed in (somebody who is neither anonymous nor an admin), removed afterwards. */
export interface Account {
  id: string;
  token: string;
  customer: Customer;
}

export async function newCustomer({ request, api, adminToken, cleanups }: World): Promise<Account> {
  const customer = fakeCustomer();
  // The removal is registered before the registration is made, and finds the account by its e-mail: a registration whose answer never
  // arrived, or a login that fails, still leaves nothing behind, and no id has to be known first.
  cleanups.push(async () => {
    const token = await adminToken();
    const user = await api.findUserByEmail(token, customer.email);
    if (user) await api.deleteUser(token, user.id);
  });
  await api.registerCustomer(customer);
  const token = await api.login(customer.email, customer.password);
  const { id } = await (await call(request, 'GET', '/users/me', { token })).json();
  return { id, token, customer };
}

/** The body `PUT /users/{id}` accepts for a customer as registered, with the first name and the role the caller wants to send instead. */
export function profileBody({ customer }: Pick<Account, 'customer'>, { firstName = customer.firstName, role }: { firstName?: string; role?: string } = {}) {
  return {
    first_name: firstName,
    last_name: customer.lastName,
    dob: customer.dateOfBirth,
    phone: customer.phone,
    email: customer.email,
    address: { street: customer.address.street, city: customer.address.city, state: customer.address.state, country: customer.address.country, postal_code: customer.address.postalCode },
    ...(role ? { role } : {}),
  };
}

// Shared by the four authorization-*.spec.ts files.
export type Caller = 'anonymous' | 'customer';
export const CALLERS: Caller[] = ['anonymous', 'customer'];
export const WHO: Record<Caller, string> = { anonymous: 'an anonymous caller', customer: 'a customer' };

/** What creating a record answers. */
export const CREATED = 201;
/** The first names the profile checks write: the owner's own change, and the one an intruder tries. */
export const OWN_NAME = 'Changed';
export const INTRUDER_NAME = 'Hijacked';
/** The subject and body of the contact message the checks send. */
export const MESSAGE = { subject: 'webmaster', message: 'Sent by the authorisation checks to see who may list or change it.' } as const;

/** Whether an answer is a verdict on authorisation at all: accepted (2xx) or refused (401, 403). Anything else is not one. */
export function expectVerdict(response: APIResponse, what: string): void {
  expect(response.ok() || REFUSED.includes(response.status()), `${what} answered ${response.status()}: neither accepted nor refused, so it says nothing about who may call it`).toBe(true);
}

/** The token a caller presents: none for an anonymous one, a freshly registered customer's otherwise. */
export async function tokenFor(world: World, caller: Caller): Promise<string | undefined> {
  return caller === 'customer' ? (await newCustomer(world)).token : undefined;
}

/**
 * A contact message of the test's own: sent through the public API, then found again in the admin's inbox by its sender (the inbox is
 * paged, so every page is read until it turns up) and its id returned. A message nobody can delete is left behind, uniquely named.
 */
export async function contactMessage(world: World, name: string): Promise<string> {
  await world.api.sendContactMessage({ name, email: uniqueEmail('authz'), ...MESSAGE });
  const admin = await world.adminToken();
  const inboxPage = async (page: number) => (await call(world.request, 'GET', `/messages?page=${page}`, { token: admin })).json();
  const first = await inboxPage(1);
  const lastPage = first.last_page as number;
  for (let page = 1; page <= lastPage; page++) {
    const inbox = page === 1 ? first : await inboxPage(page);
    const found = (inbox.data as { id: string; name: string }[]).find((message) => message.name === name);
    if (found) return found.id;
  }
  throw new Error(`the message from "${name}" is not in the admin's inbox (${lastPage} page(s) read)`);
}

/** A customer's favourite, made through the API, and its id. The owner's own cleanup removes it before the account goes. */
export async function favouriteOf(world: World, owner: Account, catalogProduct: Product): Promise<string> {
  await world.api.addFavorite(owner.token, catalogProduct.id);
  const [favourite] = (await (await call(world.request, 'GET', '/favorites', { token: owner.token })).json()) as { id: string }[];
  expect(favourite, 'the owner has the favourite just added').toBeDefined();
  removeFavouritesLater(world, owner);
  return favourite.id;
}
export const hasFavourite = async (request: APIRequestContext, owner: Account, id: string) =>
  ((await (await call(request, 'GET', '/favorites', { token: owner.token })).json()) as { id: string }[]).some((favourite) => favourite.id === id);

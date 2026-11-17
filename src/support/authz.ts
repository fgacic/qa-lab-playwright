import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { Cleanups } from '@fixtures/cleanups';
import { API_URL } from '@support/env';
import { fakeCustomer, type Customer } from '@support/test-data';
import type { ToolshopApi } from '@support/toolshop-api';

/**
 * What the API-level security specs (tests/security/authorization, cart-access, login-lockout) share: one authenticated-or-not call,
 * the statuses that count as a refusal, and the accounts and removals a test arranges. Every helper here writes to the shop's database,
 * so the specs that use them are `@self-hosted`.
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

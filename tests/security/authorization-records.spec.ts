import { mergeTests, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { worldTest } from '@fixtures/security';
import { call, newCustomer, profileBody, REFUSED, REFUSED_OR_HIDDEN, favouriteOf, hasFavourite, WHO, OWN_NAME, INTRUDER_NAME, expectVerdict, tokenFor, contactMessage, type Caller, type World, type Account } from '@support/authz';
import { knownBug } from '@support/known-bug';
import { fromBase64Url } from '@support/payloads';
import { fakeGuest, uniqueKey } from '@support/test-data';
import type { Product, ToolshopApi } from '@support/toolshop-api';

/**
 * Authorisation of the API itself, below the UI: who may call what. This file: Writes to records other people own: a profile's role field, other customers' profiles and favourites, order and message statuses.
 * (The authorization-*.spec.ts files are one suite, split by concern; the conventions they share, which statuses count as a refusal,
 * what is cleaned up and what is left behind, are stated once in `@support/authz`.)
 */
const test = mergeTests(apiOnlyTest, worldTest);

/**
 * Mass assignment: a profile update carries a `role`. Only the admin may set it, and a customer sending it must not become one.
 * The control gives the admin the same body on a customer made for the test, and proves the field is honoured at all.
 */
test.describe('API authorisation, the role field of a profile (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  const bodyOf = (account: Account, role: string) => profileBody(account, { role });
  /** The role in the claims of a fresh sign-in: where the API itself says what the account may do. */
  const roleOf = async (api: ToolshopApi, { customer }: Account) => fromBase64Url<{ role: string }>((await api.login(customer.email, customer.password)).split('.')[1]).role;

  test('the admin can change the role of an account, so the field is honoured', async ({ request, api, adminToken, cleanups }) => {
    const account = await newCustomer({ request, api, adminToken, cleanups });

    const response = await call(request, 'PUT', `/users/${account.id}`, { token: await adminToken(), data: bodyOf(account, 'admin') });

    expect(response.status(), 'the admin changed the role').toBe(200);
    expect(await roleOf(api, account), 'a new sign-in carries the role').toBe('admin');
  });

  test('a customer cannot make themselves an admin through their own profile', async ({ request, api, adminToken, cleanups }) => {
    const account = await newCustomer({ request, api, adminToken, cleanups });

    const response = await call(request, 'PUT', `/users/${account.id}`, { token: account.token, data: bodyOf(account, 'admin') });

    // The verdict is what the account became (the role a fresh sign-in carries); how the shop answered is the softer signal, kept next to it.
    expect.soft(REFUSED, `a customer sending role "admin" in their own profile got ${response.status()}`).toContain(response.status());
    expect(await roleOf(api, account), 'the account is still a plain user').toBe('user');
  });
});

/**
 * Writes to what other people own, or to what only the admin may touch: another customer's profile and favourites, an
 * order's status, a contact message's status. The target is always a record the test made. A guest order and a contact
 * message are made through the public API (no account owns them, and neither can be deleted: see the header), so they
 * stay behind, uniquely named; a status a pin shows a customer could set stays on that throwaway record, which nobody reads.
 */
test.describe('API authorisation, writes to other records (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  const profileOf = (account: Account, firstName: string) => profileBody(account, { firstName });
  const nameOf = async (request: APIRequestContext, token: string) => ((await (await call(request, 'GET', '/users/me', { token })).json()) as { first_name: string }).first_name;

  test("a customer cannot change another customer's profile", async ({ request, world }) => {
    const owner = await newCustomer(world);
    const intruder = await newCustomer(world);
    // The control: the owner's own PUT with the same body is accepted and lands, so a refusal is about who is asking.
    const own = await call(request, 'PUT', `/users/${owner.id}`, { token: owner.token, data: profileOf(owner, OWN_NAME) });
    expect(own.status(), 'the owner could change their own profile with this body').toBe(200);
    expect(await nameOf(request, owner.token), 'the owner read the change back').toBe(OWN_NAME);

    const response = await call(request, 'PUT', `/users/${owner.id}`, { token: intruder.token, data: profileOf(owner, INTRUDER_NAME) });

    expect(REFUSED, `a customer changing another customer's profile got ${response.status()}`).toContain(response.status());
    expect(await nameOf(request, owner.token), "the owner's name is untouched").toBe(OWN_NAME);
  });

  test("an anonymous caller cannot change a customer's profile", async ({ request, api, adminToken, cleanups }) => {
    const owner = await newCustomer({ request, api, adminToken, cleanups });

    const response = await call(request, 'PUT', `/users/${owner.id}`, { data: profileOf(owner, INTRUDER_NAME) });

    expect(REFUSED, `an anonymous PUT of a customer's profile got ${response.status()}`).toContain(response.status());
    expect(await nameOf(request, owner.token), "the owner's name is untouched").toBe(owner.customer.firstName);
  });

  test("an anonymous caller cannot delete a customer's account", async ({ request, api, adminToken, cleanups }) => {
    const owner = await newCustomer({ request, api, adminToken, cleanups });

    const response = await call(request, 'DELETE', `/users/${owner.id}`);

    expect(REFUSED, `an anonymous DELETE of a customer's account got ${response.status()}`).toContain(response.status());
    expect((await call(request, 'GET', `/users/${owner.id}`, { token: await adminToken() })).status(), 'the account is still there').toBe(200);
  });

  test("a customer cannot delete another customer's account", async ({ request, adminToken, world }) => {
    const owner = await newCustomer(world);
    const intruder = await newCustomer(world);

    const response = await call(request, 'DELETE', `/users/${owner.id}`, { token: intruder.token });

    expect(REFUSED, `a customer deleting another customer's account got ${response.status()}`).toContain(response.status());
    expect((await call(request, 'GET', `/users/${owner.id}`, { token: await adminToken() })).status(), 'the account is still there').toBe(200);
  });

  test('a customer can remove their own favourite', async ({ request, catalog, world }) => {
    const owner = await newCustomer(world);
    const id = await favouriteOf(world, owner, await catalog.inStock());

    const response = await call(request, 'DELETE', `/favorites/${id}`, { token: owner.token });

    expect(response.status(), 'the owner removed their favourite').toBe(204);
    expect(await hasFavourite(request, owner, id), 'it is gone').toBe(false);
  });

  test("a customer cannot remove another customer's favourite", async ({ request, catalog, world }) => {
    const owner = await newCustomer(world);
    const intruder = await newCustomer(world);
    const id = await favouriteOf(world, owner, await catalog.inStock());

    await call(request, 'DELETE', `/favorites/${id}`, { token: intruder.token });

    // Whatever the shop answers (SEC-12 pins the answer), the favourite itself must survive.
    expect(await hasFavourite(request, owner, id), "the owner's favourite is still there").toBe(true);
  });

  test("an anonymous caller cannot remove a customer's favourite", async ({ request, catalog, world }) => {
    const owner = await newCustomer(world);
    const id = await favouriteOf(world, owner, await catalog.inStock());

    const response = await call(request, 'DELETE', `/favorites/${id}`);

    expect(REFUSED, `an anonymous DELETE of a customer's favourite got ${response.status()}`).toContain(response.status());
    expect(await hasFavourite(request, owner, id), "the owner's favourite is still there").toBe(true);
  });

  test.describe('the answer to the same attempt', { tag: ['@bug'] }, () => {
    test("removing another customer's favourite is refused, not answered with a success", async ({ request, catalog, world }) => {
      knownBug('SEC-12', "DELETE /favorites/{id} by another customer answers 204 (success) although nothing is deleted: the refusal is silent and the caller cannot tell it from a delete.");
      const owner = await newCustomer(world);
      const intruder = await newCustomer(world);
      const id = await favouriteOf(world, owner, await catalog.inStock());

      const response = await call(request, 'DELETE', `/favorites/${id}`, { token: intruder.token });
      // Precondition, true whether or not the bug is fixed: the favourite survived, so what is wrong is only the answer.
      expect(await hasFavourite(request, owner, id), "the owner's favourite is still there").toBe(true);

      expect(REFUSED_OR_HIDDEN, `SEC-12: DELETE /favorites/{id} by another customer answered ${response.status()}`).toContain(response.status());
    });
  });

  /** The order statuses and message statuses the back office sets (the admin specs use the same words). */
  const STATUS = { order: { from: 'AWAITING_FULFILLMENT', to: 'ON_HOLD' }, message: { from: 'NEW', to: 'IN_PROGRESS' } } as const;

  /** A guest order of the test's own, made through the public API; its id and its status as the admin sees it. */
  async function guestOrder(world: World, catalog: { inStock(): Promise<Product> }) {
    const order = await world.api.placeGuestOrder([{ product: await catalog.inStock(), quantity: 1 }], fakeGuest());
    return order.id;
  }

  const statusOf = async (request: APIRequestContext, path: string, token: string) => ((await (await call(request, 'GET', path, { token })).json()) as { status: string }).status;

  /** A short key no other test, worker, retry or run shares: a contact message's name is capped, and a UUID is longer than the cap. */
  
  test('the admin can change the status of an order and of a message, with the bodies the attempts below send', async ({ request, adminToken, catalog, world }) => {
    const admin = await adminToken();
    const order = await guestOrder(world, catalog);
    const message = await contactMessage(world, `Authz admin ${uniqueKey()}`);

    const orderResponse = await call(request, 'PUT', `/invoices/${order}/status`, { token: admin, data: { status: STATUS.order.to } });
    const messageResponse = await call(request, 'PUT', `/messages/${message}/status`, { token: admin, data: { status: STATUS.message.to } });

    expect([orderResponse.status(), messageResponse.status()], 'the admin could set both statuses').toEqual([200, 200]);
    expect([await statusOf(request, `/invoices/${order}`, admin), await statusOf(request, `/messages/${message}`, admin)], 'read back as the admin').toEqual([STATUS.order.to, STATUS.message.to]);
  });

  /** One attempt to set a status the admin owns: what the caller was answered, and the status the record had before and has after. */
  interface Attempt {
    response: APIResponse;
    before: string;
    after: string;
  }
  async function setOrderStatus(world: World, catalog: { inStock(): Promise<Product> }, caller: Caller): Promise<Attempt> {
    const order = await guestOrder(world, catalog);
    const admin = await world.adminToken();
    const before = await statusOf(world.request, `/invoices/${order}`, admin);
    expect(before, 'the order starts as the shop leaves a new one').toBe(STATUS.order.from);
    const token = await tokenFor(world, caller);
    const response = await call(world.request, 'PUT', `/invoices/${order}/status`, { token, data: { status: STATUS.order.to } });
    expectVerdict(response, `PUT /invoices/{id}/status as ${WHO[caller]}`);
    return { response, before, after: await statusOf(world.request, `/invoices/${order}`, admin) };
  }
  async function setMessageStatus(world: World, key: string, caller: Caller): Promise<Attempt> {
    const message = await contactMessage(world, `Authz ${caller} ${key}`);
    const admin = await world.adminToken();
    const before = await statusOf(world.request, `/messages/${message}`, admin);
    expect(before, 'the message starts as the shop leaves a new one').toBe(STATUS.message.from);
    const token = await tokenFor(world, caller);
    const response = await call(world.request, 'PUT', `/messages/${message}/status`, { token, data: { status: STATUS.message.to } });
    expectVerdict(response, `PUT /messages/{id}/status as ${WHO[caller]}`);
    return { response, before, after: await statusOf(world.request, `/messages/${message}`, admin) };
  }

  // An anonymous caller is refused today (401): a plain check that stays green, with the customer's pin below it.
  test("an order's status cannot be set by an anonymous caller", async ({ request, api, adminToken, cleanups, catalog }) => {
    const { response, before, after } = await setOrderStatus({ request, api, adminToken, cleanups }, catalog, 'anonymous');

    expect(REFUSED, `PUT /invoices/{id}/status as an anonymous caller answered ${response.status()}`).toContain(response.status());
    expect(after, 'the order is unchanged').toBe(before);
  });

  test("a message's status cannot be set by an anonymous caller", async ({ request, api, adminToken, cleanups }) => {
    const { response, before, after } = await setMessageStatus({ request, api, adminToken, cleanups }, uniqueKey(), 'anonymous');

    expect(REFUSED, `PUT /messages/{id}/status as an anonymous caller answered ${response.status()}`).toContain(response.status());
    expect(after, 'the message is unchanged').toBe(before);
  });

  test.describe('who may set a status', { tag: ['@bug'] }, () => {
    test("an order's status cannot be set by a customer", async ({ request, api, adminToken, cleanups, catalog }) => {
      knownBug('SEC-10', 'PUT /invoices/{id}/status is accepted from a customer: anybody with an account can ship, hold or complete an order.');

      const { response, before, after } = await setOrderStatus({ request, api, adminToken, cleanups }, catalog, 'customer');

      expect.soft(REFUSED, `SEC-10: PUT /invoices/{id}/status as a customer answered ${response.status()}`).toContain(response.status());
      expect.soft(after, `SEC-10: the order is now "${after}" (read back as the admin), set by a customer`).toBe(before);
    });

    test("a message's status cannot be set by a customer", async ({ request, api, adminToken, cleanups }) => {
      knownBug('SEC-11', 'PUT /messages/{id}/status is accepted from a customer: anybody with an account can mark the contact inbox read, in progress or done.');

      const { response, before, after } = await setMessageStatus({ request, api, adminToken, cleanups }, uniqueKey(), 'customer');

      expect.soft(REFUSED, `SEC-11: PUT /messages/{id}/status as a customer answered ${response.status()}`).toContain(response.status());
      expect.soft(after, `SEC-11: the message is now "${after}" (read back as the admin), set by a customer`).toBe(before);
    });
  });
});

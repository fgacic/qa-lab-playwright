import { randomUUID } from 'node:crypto';
import { mergeTests } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { worldTest } from '@fixtures/security';
import { call, newCustomer, REFUSED_OR_HIDDEN, removeFavouritesLater, contactMessage } from '@support/authz';
import { fakeGuest } from '@support/test-data';

/**
 * Authorisation of the API itself, below the UI: who may call what. This file: Who may read what: the reads that need a token, and the lists that hold only the caller's own rows. (The authorization-*.spec.ts files are one suite, split by concern.) A page only hides a button, the API is what enforces,
 * so these are plain HTTP calls with no token, with a customer's token and with the admin's. They write to our own
 * database and try to read other people's data, so they only ever run against the self-hosted Toolshop (@self-hosted).
 * No browser is involved, so the file is tagged @api and scheduled once (in Chromium) instead of once per browser.
 *
 * A call is refused by 401 (no valid token) or 403 (a token that may not), and a record that belongs to somebody else is
 * hidden by a 403 or a 404: all of those count as "refused". A success (2xx) is "accepted". Any other answer (a 404 on a
 * route that should exist, a 405, a 500) is neither: it says nothing about authorisation, so it fails the test without
 * naming a defect id. Every "refused" check that tolerates a 404 comes after a control in which the admin gets a 200 from the
 * same path, so a typo in a path cannot pass as a refusal.
 *
 * What each test makes, it removes again, pass or fail, in reverse order: the records the admin API can delete (brands,
 * categories, products, the customers a test registers, the favourites that would block deleting them). Two kinds are left
 * behind on purpose, all uniquely named and harmless on the throwaway database of the self-hosted target, which is rebuilt
 * for every CI run: guest orders (DELETE /invoices/{id} answers 405) and contact messages (DELETE /messages/{id} answers 405).
 * No seeded record is ever changed: a first draft of the catalogue pins edited a seeded product to prove a point, which
 * is why every write is aimed at a record the test made.
 *
 * The file runs on `apiOnlyTest`: no browser context is opened, since every check is a plain HTTP call.
 */
const test = mergeTests(apiOnlyTest, worldTest);

test.describe('API authorisation, read access (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  const ADMIN_ONLY = ['/users', '/reports/total-sales-per-country', '/reports/average-sales-per-month', '/reports/customers-by-country'];
  /** Every read that needs a token: what any signed-in caller may ask for, and what only the admin may. */
  const NEEDS_A_TOKEN = ['/users/me', '/invoices', '/favorites', '/messages', ...ADMIN_ONLY];

  for (const path of NEEDS_A_TOKEN) {
    test(`GET ${path} needs a token`, async ({ request }) => {
      const response = await call(request, 'GET', path);

      expect(response.status(), `GET ${path} without a token answered`).toBe(401);
    });
  }

  for (const path of ADMIN_ONLY) {
    test(`GET ${path} is refused to a customer`, async ({ request, api, adminToken, cleanups }) => {
      // The control: the admin gets the data from the same path, so the customer's answer is about who is asking.
      const control = await call(request, 'GET', path, { token: await adminToken() });
      expect(control.status(), `GET ${path} as the admin answered`).toBe(200);
      const { token } = await newCustomer({ request, api, adminToken, cleanups });

      const response = await call(request, 'GET', path, { token });

      expect(response.status(), `GET ${path} with a customer's token answered`).toBe(403);
    });
  }

  test("a customer cannot read somebody else's invoice", async ({ request, api, adminToken, cleanups }) => {
    const admin = await adminToken();
    const invoices = await (await call(request, 'GET', '/invoices', { token: admin })).json();
    expect(invoices.data.length, 'the admin sees at least one invoice (the shop is seeded with some)').toBeGreaterThan(0);
    const [{ id: invoiceId }] = invoices.data as { id: string }[];
    const control = await call(request, 'GET', `/invoices/${invoiceId}`, { token: admin });
    expect(control.status(), 'the admin can read that invoice, so a 404 for the customer is a hiding and not a wrong path').toBe(200);
    const { token } = await newCustomer({ request, api, adminToken, cleanups });

    const response = await call(request, 'GET', `/invoices/${invoiceId}`, { token });

    expect(REFUSED_OR_HIDDEN, `a customer asking for another customer's invoice got ${response.status()}`).toContain(response.status());
  });

  test("a customer cannot read somebody else's account", async ({ request, api, adminToken, cleanups }) => {
    const admin = await adminToken();
    const { id: ownId, token } = await newCustomer({ request, api, adminToken, cleanups });
    const users = await (await call(request, 'GET', '/users', { token: admin })).json();
    // Somebody who is not the caller, picked by id: the list may well hold the customer made just above.
    const someoneElse = (users.data as { id: string }[]).find((user) => user.id !== ownId);
    expect(someoneElse, 'the admin lists an account other than the caller\'s').toBeDefined();
    const control = await call(request, 'GET', `/users/${someoneElse!.id}`, { token: admin });
    expect(control.status(), 'the admin can read that account, so a 404 for the customer is a hiding and not a wrong path').toBe(200);

    const response = await call(request, 'GET', `/users/${someoneElse!.id}`, { token });

    expect(REFUSED_OR_HIDDEN, `a customer asking for another account got ${response.status()}`).toContain(response.status());
  });
});

/**
 * What a list holds for a customer: only their own rows. The other records are made by the test (a guest order and a contact
 * message belong to nobody with an account, another customer's favourite to somebody else), and each is first read as the admin,
 * so an absence in the customer's list is about who is asking and not about a record that was never made.
 */
test.describe('API authorisation, list scoping (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  test('a customer lists no invoice that belongs to somebody else', async ({ request, api, adminToken, cleanups, catalog }) => {
    const admin = await adminToken();
    const order = await api.placeGuestOrder([{ product: await catalog.inStock(), quantity: 1 }], fakeGuest());
    const control = await call(request, 'GET', `/invoices/${order.id}`, { token: admin });
    expect(control.status(), 'the admin can read the order, so it exists').toBe(200);
    const { token } = await newCustomer({ request, api, adminToken, cleanups });

    const listed = await (await call(request, 'GET', '/invoices', { token })).json();

    expect((listed.data as { id: string }[]).map((invoice) => invoice.id), "a new customer's invoice list is empty: it holds no one else's order").toEqual([]);
  });

  test('a customer lists no contact message that somebody else sent', async ({ request, world }) => {
    // The control: the admin's inbox holds the message (found by paging through it), so its absence below is about who is asking.
    await contactMessage(world, `Authz scoping ${randomUUID().slice(0, 8)}`);
    const { token } = await newCustomer(world);

    const listed = await (await call(request, 'GET', '/messages', { token })).json();

    expect((listed.data as { name: string }[]).map((message) => message.name), "a new customer's message list holds no one else's message").toEqual([]);
  });

  test("a customer lists no favourite that is another customer's", async ({ request, api, catalog, world }) => {
    const owner = await newCustomer(world);
    const other = await newCustomer(world);
    await api.addFavorite(owner.token, (await catalog.inStock()).id);
    removeFavouritesLater(world, owner);
    expect(await api.favoriteProductIds(owner.token), 'the owner holds the favourite, so it exists').toHaveLength(1);

    const listed = await (await call(request, 'GET', '/favorites', { token: other.token })).json();

    expect(listed, "the other customer's favourite list holds nothing of the owner's").toEqual([]);
  });
});

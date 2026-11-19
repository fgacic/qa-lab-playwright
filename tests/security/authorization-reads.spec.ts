import { randomUUID } from 'node:crypto';
import { mergeTests } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { worldTest } from '@fixtures/security';
import { call, newCustomer, REFUSED_OR_HIDDEN, removeFavouritesLater, contactMessage } from '@support/authz';
import { fakeGuest } from '@support/test-data';

/**
 * Authorisation of the API itself, below the UI: who may call what. This file: Who may read what: the reads that need a token, and the lists that hold only the caller's own rows.
 * (The authorization-*.spec.ts files are one suite, split by concern; the conventions they share, which statuses count as a refusal,
 * what is cleaned up and what is left behind, are stated once in `@support/authz`.)
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

  test("a customer cannot read somebody else's invoice", async ({ request, api, adminToken, cleanups, catalog }) => {
    const admin = await adminToken();
    // An order the test places itself (a guest's, who has no account), so the invoice does not depend on what the shop was seeded with.
    const { id: invoiceId } = await api.placeGuestOrder([{ product: await catalog.inStock(), quantity: 1 }], fakeGuest());
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

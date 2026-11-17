import { randomUUID } from 'node:crypto';
import { mergeTests, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { worldTest } from '@fixtures/security';
import { call, newCustomer, profileBody, REFUSED, REFUSED_OR_HIDDEN, removeFavouritesLater, removeLater, type Account, type World } from '@support/authz';
import { knownBug } from '@support/known-bug';
import { base64Url, fakeJwt, fromBase64Url } from '@support/payloads';
import { fakeGuest, uniqueEmail } from '@support/test-data';
import type { Product, ToolshopApi } from '@support/toolshop-api';

/**
 * Authorisation of the API itself, below the UI: who may call what. A page only hides a button, the API is what enforces,
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

type Caller = 'anonymous' | 'customer';
const CALLERS: Caller[] = ['anonymous', 'customer'];
const WHO: Record<Caller, string> = { anonymous: 'an anonymous caller', customer: 'a customer' };

/** What creating a record answers. */
const CREATED = 201;
/** The first names the profile checks write: the owner's own change, and the one an intruder tries. */
const OWN_NAME = 'Changed';
const INTRUDER_NAME = 'Hijacked';
/** The subject and body of the contact message the checks send. */
const MESSAGE = { subject: 'webmaster', message: 'Sent by the authorisation checks to see who may list or change it.' } as const;

/** Whether an answer is a verdict on authorisation at all: accepted (2xx) or refused (401, 403). Anything else is not one. */
function expectVerdict(response: APIResponse, what: string): void {
  expect(response.ok() || REFUSED.includes(response.status()), `${what} answered ${response.status()}: neither accepted nor refused, so it says nothing about who may call it`).toBe(true);
}

/** The token a caller presents: none for an anonymous one, a freshly registered customer's otherwise. */
async function tokenFor(world: World, caller: Caller): Promise<string | undefined> {
  return caller === 'customer' ? (await newCustomer(world)).token : undefined;
}

/**
 * A contact message of the test's own: sent through the public API, then found again in the admin's inbox by its sender (the inbox is
 * paged, so every page is read until it turns up) and its id returned. A message nobody can delete is left behind, uniquely named.
 */
async function contactMessage(world: World, name: string): Promise<string> {
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
 * A token the API itself did not sign must be refused as no token at all (401). Each forgery is built from the admin's real
 * token or from scratch, and each is judged against the same admin-only path where the real token gets a 200, so a refusal is
 * about the signature and not about the path.
 */
test.describe('API authorisation, forged tokens (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  const ADMIN_PATH = '/users';

  /** The forgeries, as functions of a real admin token (`header.payload.signature`). */
  const FORGERIES: Record<string, (real: string) => string> = {
    'the admin token with a changed signature': (real) => {
      const [header, payload, signature] = real.split('.');
      return `${header}.${payload}.${signature.slice(0, -4)}${signature.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    },
    'the admin token with an altered payload and the old signature': (real) => {
      const [header, payload, signature] = real.split('.');
      const claims = fromBase64Url<Record<string, unknown>>(payload);
      return `${header}.${base64Url({ ...claims, exp: (claims.exp as number) + 3600 })}.${signature}`;
    },
    'the admin claims with alg "none" and no signature': (real) => `${base64Url({ typ: 'JWT', alg: 'none' })}.${real.split('.')[1]}.`,
    'the admin claims with alg "none" and the old signature': (real) => `${base64Url({ typ: 'JWT', alg: 'none' })}.${real.split('.')[1]}.${real.split('.')[2]}`,
    'a made-up admin token that was never signed': () => fakeJwt('admin'),
    'text that is not a token at all': () => 'not.a.jwt',
  };

  test('the admin token itself is accepted on the path the forgeries are sent to', async ({ request, adminToken }) => {
    const response = await call(request, 'GET', ADMIN_PATH, { token: await adminToken() });

    expect(response.status(), `GET ${ADMIN_PATH} as the admin answered`).toBe(200);
  });

  // The other direction: a real customer's token, with its claims promoted to admin and the old signature. The signature is what
  // makes the claims the API's own, so it must not let a customer write their own role.
  test('a customer token with its role changed to admin and the old signature is refused', async ({ request, api, adminToken, cleanups }) => {
    const { token } = await newCustomer({ request, api, adminToken, cleanups });
    const [header, payload, signature] = token.split('.');
    const claims = fromBase64Url<Record<string, unknown>>(payload);
    expect(claims.role, 'the customer token carries the role the forgery changes').toBe('user');
    const forged = `${header}.${base64Url({ ...claims, role: 'admin' })}.${signature}`;

    const response = await call(request, 'GET', ADMIN_PATH, { token: forged });

    expect(response.status(), `GET ${ADMIN_PATH} with a customer token promoted to admin answered`).toBe(401);
  });

  for (const [name, forge] of Object.entries(FORGERIES)) {
    test(`${name} is refused`, async ({ request, adminToken }) => {
      const forged = forge(await adminToken());

      const response = await call(request, 'GET', ADMIN_PATH, { token: forged });

      expect(response.status(), `GET ${ADMIN_PATH} with ${name} answered`).toBe(401);
    });
  }
});

/**
 * A token that was valid, and whose session or account has ended since: it must stop working at once, not when it expires. The
 * token is a real one in both cases (a fresh sign-in), judged on `GET /users/me`, where it works until the session ends.
 */
test.describe('API authorisation, tokens after the session ended (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  test('a token is refused once its holder signed out', async ({ request, api, adminToken, cleanups }) => {
    const { token } = await newCustomer({ request, api, adminToken, cleanups });
    expect((await call(request, 'GET', '/users/me', { token })).status(), 'the token worked before signing out').toBe(200);
    expect((await call(request, 'GET', '/users/logout', { token })).status(), 'signing out answered').toBe(200);

    const response = await call(request, 'GET', '/users/me', { token });

    expect(response.status(), 'GET /users/me with the token of a signed-out session answered').toBe(401);
  });

  test.describe('after the account was deleted', { tag: ['@bug'] }, () => {
    // Every call a signed-in customer makes with the token, each judged on its own: the deleted account is gone for the admin, so any of
    // them that still answers 200 is a token that outlived it. The pin is soft per call, so one answer cannot hide another.
    const WITH_A_TOKEN = ['/users/me', '/invoices', '/favorites', '/messages', '/users/refresh'];

    test('a token of a deleted account is refused', async ({ request, api, adminToken, cleanups }) => {
      knownBug('SEC-14', "the token of an account the admin deleted is still accepted: GET /users/me, /invoices, /favorites, /messages and /users/refresh answer 200 as the deleted customer.");
      const { id, customer } = await newCustomer({ request, api, adminToken, cleanups });
      // Every path gets two sign-ins of its own: one used now, as the control that the call works with a token of this account, and one kept
      // untouched for after the deletion. Not one token for everything: `/users/refresh` retires the token it is called with, so a control
      // made with the kept token would end it and the pin could pass for that reason, not because the deleted account was refused.
      const kept: Record<string, string> = {};
      for (const path of WITH_A_TOKEN) {
        const control = await api.login(customer.email, customer.password);
        expect((await call(request, 'GET', path, { token: control })).status(), `GET ${path} worked with a token of this account before it was deleted`).toBe(200);
        kept[path] = await api.login(customer.email, customer.password);
      }
      const admin = await adminToken();
      await api.deleteUser(admin, id);
      // Precondition, true whether or not the bug is fixed: the account is gone for the admin, so what is wrong is only that the token outlived it.
      expect((await call(request, 'GET', `/users/${id}`, { token: admin })).status(), 'the admin no longer finds the deleted account').toBe(404);

      for (const path of WITH_A_TOKEN) {
        const response = await call(request, 'GET', path, { token: kept[path] });
        expect.soft(REFUSED, `SEC-14: GET ${path} with a token of a deleted account answered ${response.status()}`).toContain(response.status());
      }
    });
  });
});

/**
 * What a customer or nobody may change. A record the test creates (as the admin) is the target of every write, and an
 * attempt that gets through is cleaned up the same way, whoever made it. Each pin reads the record back as the admin, so
 * "accepted" is proven by what landed and not only by a status code.
 */
test.describe('API authorisation, catalogue writes (self-hosted only)', { tag: ['@security', '@self-hosted', '@api'] }, () => {
  /** A name no other test, retry, repeat or run shares: the label says what it is, the random part makes it unique. */
  const unique = (label: string) => `Qa Lab Authz ${label} ${randomUUID().slice(0, 8)}`;
  const slugOf = (name: string) => name.toLowerCase().replace(/\W+/g, '-');

  /** The three admin-managed record types, each with the body that creates one and the one that renames it. */
  interface Kind {
    id: string;
    noun: string;
    plural: string;
    path: string;
    create: (name: string, product: Product) => object;
    rename: (name: string) => object;
  }
  const KINDS: Kind[] = [
    { id: 'SEC-07', noun: 'brand', plural: 'brands', path: '/brands', create: (name) => ({ name, slug: slugOf(name) }), rename: (name) => ({ name, slug: slugOf(name) }) },
    { id: 'SEC-08', noun: 'category', plural: 'categories', path: '/categories', create: (name) => ({ name, slug: slugOf(name) }), rename: (name) => ({ name, slug: slugOf(name) }) },
    {
      id: 'SEC-09',
      noun: 'product',
      plural: 'products',
      path: '/products',
      // Made as a rental: the shop's default list (what the parallel catalogue specs read) shows no rental, so the record
      // cannot disturb their counts, pages or sorting while it exists (the admin e2e specs do the same).
      create: (name, product) => ({ name, description: 'Created by the authorisation checks.', price: 1.5, category_id: product.category.id, brand_id: product.brand.id, product_image_id: product.product_image.id, is_location_offer: false, is_rental: true }),
      rename: (name) => ({ name }),
    },
  ];

  /** The record as the admin sees it now, or undefined when it is not there. A category has no read-by-id (405), so it is looked for in the list. */
  async function read(request: APIRequestContext, kind: Kind, id: string, token: string): Promise<{ name: string } | undefined> {
    if (kind.noun === 'category') return ((await (await call(request, 'GET', kind.path, { token })).json()) as { id: string; name: string }[]).find((record) => record.id === id);
    const response = await call(request, 'GET', `${kind.path}/${id}`, { token });
    return response.status() === 200 ? response.json() : undefined;
  }

  /**
   * Whether an attempt to create a record made one. An attempt that got through made a record: it is removed by the id the answer
   * carries (a search by name is not reliable here: the shop's product search answers nothing for a full "Qa Lab ..." name),
   * and read back as the admin first.
   */
  async function landedAfterCreate(world: World, kind: Kind, response: APIResponse, name: string): Promise<boolean> {
    if (!response.ok()) return false;
    const { id } = (await response.json()) as { id: string };
    removeLater(world, `${kind.path}/${id}`);
    return (await read(world.request, kind, id, await world.adminToken()))?.name === name;
  }

  /** The admin makes a record of the test's own, to be the target of an attempt. It is removed afterwards. */
  async function makeRecord(world: World, kind: Kind, name: string, template: Product): Promise<string> {
    const created = await call(world.request, 'POST', kind.path, { token: await world.adminToken(), data: kind.create(name, template) });
    expect(created.status(), 'the admin could create the record the attempt targets').toBe(CREATED);
    const { id } = await created.json();
    removeLater(world, `${kind.path}/${id}`);
    return id;
  }

  for (const kind of KINDS) {
    // Controls: the very same bodies, sent by the admin, are accepted and land. Without them a refusal below could be a
    // validation answer in disguise, and the pins' "accepted" a coincidence.
    test(`${kind.noun}: the admin can create one and change it, with the bodies the attempts below send`, async ({ request, api, adminToken, cleanups, catalog }) => {
      const template = await catalog.inStock();
      const admin = await adminToken();
      const name = unique(kind.noun);

      const created = await call(request, 'POST', kind.path, { token: admin, data: kind.create(name, template) });
      expect(created.status(), `POST ${kind.path} as the admin answered`).toBe(CREATED);
      const { id } = await created.json();
      removeLater({ request, api, adminToken, cleanups }, `${kind.path}/${id}`);
      const renamed = `${name} changed`;
      const changed = await call(request, 'PUT', `${kind.path}/${id}`, { token: admin, data: kind.rename(renamed) });

      expect(changed.ok(), `PUT ${kind.path}/{id} as the admin answered ${changed.status()}`).toBe(true);
      expect((await read(request, kind, id, admin))?.name, 'the admin read the new name back').toBe(renamed);
    });

    test.describe(`${kind.plural}, writes`, { tag: ['@bug'] }, () => {
      for (const caller of CALLERS) {
        test(`${kind.noun}: ${WHO[caller]} cannot create one`, async ({ request, catalog, world }) => {
          knownBug(kind.id, `POST ${kind.path} is accepted from ${WHO[caller]}: the write is not authorised.`);
          const template = await catalog.inStock();
          const token = await tokenFor(world, caller);
          const name = unique(kind.noun);

          const response = await call(request, 'POST', kind.path, { token, data: kind.create(name, template) });
          expectVerdict(response, `POST ${kind.path} as ${WHO[caller]}`);
          const landed = await landedAfterCreate(world, kind, response, name);

          expect.soft(REFUSED, `${kind.id}: POST ${kind.path} as ${WHO[caller]} answered ${response.status()}`).toContain(response.status());
          expect.soft(landed, `${kind.id}: the record ${WHO[caller]} posted was created (read back as the admin)`).toBe(false);
        });

        test(`${kind.noun}: ${WHO[caller]} cannot change one`, async ({ request, adminToken, catalog, world }) => {
          knownBug(kind.id, `PUT ${kind.path}/{id} is accepted from ${WHO[caller]}: the write is not authorised.`);
          const template = await catalog.inStock();
          const token = await tokenFor(world, caller);
          const name = unique(kind.noun);
          // The record is the test's own, made by the admin: whatever the attempt does, no seeded record is touched.
          const id = await makeRecord(world, kind, name, template);
          const renamed = `${name} changed`;

          const response = await call(request, 'PUT', `${kind.path}/${id}`, { token, data: kind.rename(renamed) });
          expectVerdict(response, `PUT ${kind.path}/{id} as ${WHO[caller]}`);
          const landed = (await read(request, kind, id, await adminToken()))?.name === renamed;

          expect.soft(REFUSED, `${kind.id}: PUT ${kind.path}/{id} as ${WHO[caller]} answered ${response.status()}`).toContain(response.status());
          expect.soft(landed, `${kind.id}: the new name ${WHO[caller]} sent was saved (read back as the admin)`).toBe(false);
        });
      }
    });

    for (const caller of CALLERS) {
      test(`${kind.noun}: ${WHO[caller]} cannot delete one`, async ({ request, adminToken, catalog, world }) => {
        const template = await catalog.inStock();
        const token = await tokenFor(world, caller);
        const id = await makeRecord(world, kind, unique(kind.noun), template);

        const response = await call(request, 'DELETE', `${kind.path}/${id}`, { token });

        expect(REFUSED, `DELETE ${kind.path}/{id} as ${WHO[caller]} answered ${response.status()}`).toContain(response.status());
        expect(await read(request, kind, id, await adminToken()), 'the record is still there after the refused delete').toBeDefined();
      });
    }
  }
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

  /** A customer's favourite, made through the API, and its id. The owner's own cleanup removes it before the account goes. */
  async function favouriteOf(world: World, owner: Account, catalogProduct: Product): Promise<string> {
    await world.api.addFavorite(owner.token, catalogProduct.id);
    const [favourite] = (await (await call(world.request, 'GET', '/favorites', { token: owner.token })).json()) as { id: string }[];
    expect(favourite, 'the owner has the favourite just added').toBeDefined();
    removeFavouritesLater(world, owner);
    return favourite.id;
  }
  const hasFavourite = async (request: APIRequestContext, owner: Account, id: string) =>
    ((await (await call(request, 'GET', '/favorites', { token: owner.token })).json()) as { id: string }[]).some((favourite) => favourite.id === id);

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
  const newKey = () => randomUUID().slice(0, 8);

  test('the admin can change the status of an order and of a message, with the bodies the attempts below send', async ({ request, adminToken, catalog, world }) => {
    const admin = await adminToken();
    const order = await guestOrder(world, catalog);
    const message = await contactMessage(world, `Authz admin ${newKey()}`);

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
    const { response, before, after } = await setMessageStatus({ request, api, adminToken, cleanups }, newKey(), 'anonymous');

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

      const { response, before, after } = await setMessageStatus({ request, api, adminToken, cleanups }, newKey(), 'customer');

      expect.soft(REFUSED, `SEC-11: PUT /messages/{id}/status as a customer answered ${response.status()}`).toContain(response.status());
      expect.soft(after, `SEC-11: the message is now "${after}" (read back as the admin), set by a customer`).toBe(before);
    });
  });
});

import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect, test } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { API_URL } from '@support/env';
import { fakeCustomer } from '@support/test-data';
import type { Product, ToolshopApi } from '@support/toolshop-api';

/**
 * Authorisation of the API itself, below the UI: who may call what. A page only hides a button, the API is what enforces,
 * so these are plain HTTP calls with no token, with a customer's token and with the admin's. They write to our own
 * database and try to read other people's data, so they only ever run against the self-hosted Toolshop (@self-hosted).
 *
 * A call is refused by 401 (no valid token) or 403 (a token that may not), and a record that belongs to somebody else is
 * hidden by a 403 or a 404: all of those count as "refused". The one answer that is never acceptable is a success.
 *
 * Everything a test writes is its own: records are created through the admin's token under a unique name and removed
 * again, pass or fail, so no seeded record is ever changed (a first draft of the pins below edited a seeded product to
 * prove a point; that is why updates are tried on a record the test made).
 */
const REFUSED = [401, 403];
const REFUSED_OR_HIDDEN = [401, 403, 404];

type Caller = 'anonymous' | 'customer';
const CALLERS: Caller[] = ['anonymous', 'customer'];
const WHO: Record<Caller, string> = { anonymous: 'an anonymous caller', customer: 'a customer' };

/** One authenticated-or-not call to the API, asking for JSON (without it Laravel redirects a validation error). */
function call(request: APIRequestContext, method: string, path: string, { token, data }: { token?: string; data?: object } = {}): Promise<APIResponse> {
  return request.fetch(`${API_URL}${path}`, { method, data, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
}

/** The token a caller presents: none for an anonymous one, a freshly registered customer's otherwise. */
async function tokenFor(api: ToolshopApi, caller: Caller): Promise<string | undefined> {
  return caller === 'customer' ? signedInCustomer(api) : undefined;
}

/** A customer registered for this test and signed in: somebody who is neither anonymous nor an admin. */
async function signedInCustomer(api: ToolshopApi): Promise<string> {
  const customer = fakeCustomer();
  await api.registerCustomer(customer);
  return api.login(customer.email, customer.password);
}

test.describe('API authorisation, read access (self-hosted only)', { tag: ['@security', '@self-hosted'] }, () => {
  const SIGNED_IN_ONLY = ['/users/me', '/invoices', '/favorites', '/messages', '/users'];
  const ADMIN_ONLY = ['/users', '/reports/total-sales-per-country', '/reports/average-sales-per-month', '/reports/customers-by-country'];

  for (const path of SIGNED_IN_ONLY) {
    test(`GET ${path} needs a token`, async ({ request }) => {
      const response = await call(request, 'GET', path);

      expect(response.status(), `GET ${path} without a token answered`).toBe(401);
    });
  }

  for (const path of ADMIN_ONLY) {
    test(`GET ${path} is refused to a customer`, async ({ request, api }) => {
      const token = await signedInCustomer(api);

      const response = await call(request, 'GET', path, { token });

      expect(response.status(), `GET ${path} with a customer's token answered`).toBe(403);
    });
  }

  test("a customer cannot read somebody else's invoice", async ({ request, api, adminToken }) => {
    const invoices = await (await call(request, 'GET', '/invoices', { token: await adminToken() })).json();
    expect(invoices.data.length, 'the admin sees at least one invoice (the shop is seeded with some)').toBeGreaterThan(0);
    const [{ id: invoiceId }] = invoices.data as { id: string }[];
    const token = await signedInCustomer(api);

    const response = await call(request, 'GET', `/invoices/${invoiceId}`, { token });

    expect(REFUSED_OR_HIDDEN, `a customer asking for another customer's invoice got ${response.status()}`).toContain(response.status());
  });

  test("a customer cannot read somebody else's account", async ({ request, api, adminToken }) => {
    const token = await signedInCustomer(api);
    const users = await (await call(request, 'GET', '/users', { token: await adminToken() })).json();
    const [someoneElse] = users.data as { id: string }[];
    expect(someoneElse, 'the admin lists at least one account').toBeDefined();

    const response = await call(request, 'GET', `/users/${someoneElse.id}`, { token });

    expect(REFUSED_OR_HIDDEN, `a customer asking for another account got ${response.status()}`).toContain(response.status());
  });
});

/**
 * What a customer or nobody may change. A record the test creates (as the admin) is the target of every write, and an
 * attempt that gets through is cleaned up the same way, whoever made it.
 */
test.describe('API authorisation, write access (self-hosted only)', { tag: ['@security', '@self-hosted'] }, () => {
  /** Each entry removes what a test made, run after the test whether it passed or failed. */
  let cleanups: (() => Promise<void>)[] = [];

  test.beforeEach(() => {
    cleanups = [];
  });

  test.afterEach(async () => {
    const failures = (await Promise.allSettled(cleanups.map((cleanup) => cleanup()))).filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((failure) => (failure as PromiseRejectedResult).reason), `${failures.length} record(s) made by the test could not be removed`);
  });

  /** Removes a record by its id through the admin's token; a record already gone is fine. */
  const removeLater = (request: APIRequestContext, adminToken: () => Promise<string>, path: string) =>
    cleanups.push(async () => {
      const response = await call(request, 'DELETE', path, { token: await adminToken() });
      if (!response.ok() && response.status() !== 404) throw new Error(`DELETE ${path} answered ${response.status()}`);
    });

  /**
   * Products are made as rentals: the shop's default list (what the parallel catalogue specs read) shows no rental, so the
   * record cannot disturb their counts, pages or sorting while it exists (the admin e2e specs do the same).
   */
  /** The three admin-managed record types, each with the body that creates one, one that renames it and how to read its name back. */
  const unique = (testInfoId: string) => `Qa Lab Authz ${testInfoId}`;
  interface Kind {
    id: string;
    noun: string;
    plural: string;
    path: string;
    create: (name: string, product: Product) => object;
    rename: (name: string) => object;
  }
  const KINDS: Kind[] = [
    { id: 'SEC-07', noun: 'brand', plural: 'brands', path: '/brands', create: (name) => ({ name, slug: name.toLowerCase().replace(/\W+/g, '-') }), rename: (name) => ({ name, slug: name.toLowerCase().replace(/\W+/g, '-') }) },
    { id: 'SEC-08', noun: 'category', plural: 'categories', path: '/categories', create: (name) => ({ name, slug: name.toLowerCase().replace(/\W+/g, '-') }), rename: (name) => ({ name, slug: name.toLowerCase().replace(/\W+/g, '-') }) },
    {
      id: 'SEC-09',
      noun: 'product',
      plural: 'products',
      path: '/products',
      create: (name, product) => ({ name, description: 'Created by the authorisation checks.', price: 1.5, category_id: product.category.id, brand_id: product.brand.id, product_image_id: product.product_image.id, is_location_offer: false, is_rental: true }),
      rename: (name) => ({ name }),
    },
  ];

  /** An attempt that got through made a record: it is removed by the id the answer carries, whoever made it. */
  async function removeIfCreated(request: APIRequestContext, adminToken: () => Promise<string>, path: string, response: APIResponse): Promise<void> {
    if (response.ok()) removeLater(request, adminToken, `${path}/${(await response.json()).id}`);
  }

  /** Whether a record is still there. A category has no read-by-id (it answers 405), so it is looked for in the list. */
  async function exists(request: APIRequestContext, kind: Kind, id: string, token: string): Promise<boolean> {
    if (kind.noun === 'category') return ((await (await call(request, 'GET', kind.path, { token })).json()) as { id: string }[]).some((record) => record.id === id);
    return (await call(request, 'GET', `${kind.path}/${id}`, { token })).status() === 200;
  }

  for (const kind of KINDS) {
    test.describe(`${kind.plural}, writes`, { tag: ['@bug'] }, () => {
      for (const caller of CALLERS) {
        test(`${kind.noun}: ${WHO[caller]} cannot create one`, async ({ request, api, adminToken, catalog }, testInfo) => {
          knownBug(kind.id, `POST ${kind.path} is accepted from ${WHO[caller]}: the write is not authorised.`);
          const template = await catalog.inStock();
          const token = await tokenFor(api, caller);
          const name = unique(`${kind.noun} ${testInfo.testId}`);

          const response = await call(request, 'POST', kind.path, { token, data: kind.create(name, template) });
          // An attempt that got through made a record, which is removed by the id the answer carries (a search by name is
          // not reliable here: the shop's product search answers nothing for a full "Qa Lab ..." name).
          await removeIfCreated(request, adminToken, kind.path, response);

          expect(REFUSED, `${kind.id}: POST ${kind.path} as ${WHO[caller]} answered ${response.status()}`).toContain(response.status());
        });

        test(`${kind.noun}: ${WHO[caller]} cannot change one`, async ({ request, api, adminToken, catalog }, testInfo) => {
          knownBug(kind.id, `PUT ${kind.path}/{id} is accepted from ${WHO[caller]}: the write is not authorised.`);
          const template = await catalog.inStock();
          const admin = await adminToken();
          const token = await tokenFor(api, caller);
          const name = unique(`${kind.noun} ${testInfo.testId}`);
          // The record is the test's own, made by the admin: whatever the attempt does, no seeded record is touched.
          const created = await call(request, 'POST', kind.path, { token: admin, data: kind.create(name, template) });
          expect(created.status(), 'the admin could create the record the attempt targets').toBe(201);
          const { id } = await created.json();
          removeLater(request, adminToken, `${kind.path}/${id}`);

          const response = await call(request, 'PUT', `${kind.path}/${id}`, { token, data: kind.rename(`${name} changed`) });

          expect(REFUSED, `${kind.id}: PUT ${kind.path}/{id} as ${WHO[caller]} answered ${response.status()}`).toContain(response.status());
        });
      }
    });

    for (const caller of CALLERS) {
      test(`${kind.noun}: ${WHO[caller]} cannot delete one`, async ({ request, api, adminToken, catalog }, testInfo) => {
        const template = await catalog.inStock();
        const admin = await adminToken();
        const token = await tokenFor(api, caller);
        const created = await call(request, 'POST', kind.path, { token: admin, data: kind.create(unique(`${kind.noun} ${testInfo.testId}`), template) });
        expect(created.status(), 'the admin could create the record the attempt targets').toBe(201);
        const { id } = await created.json();
        removeLater(request, adminToken, `${kind.path}/${id}`);

        const response = await call(request, 'DELETE', `${kind.path}/${id}`, { token });

        expect(REFUSED, `DELETE ${kind.path}/{id} as ${WHO[caller]} answered ${response.status()}`).toContain(response.status());
        expect(await exists(request, kind, id, admin), 'the record is still there after the refused delete').toBe(true);
      });
    }
  }
});

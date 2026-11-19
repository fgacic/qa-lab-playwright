import { randomUUID } from 'node:crypto';
import { mergeTests, type APIRequestContext, type APIResponse } from '@playwright/test';
import { apiOnlyTest, expect } from '@fixtures';
import { worldTest } from '@fixtures/security';
import { call, REFUSED, removeLater, CALLERS, WHO, CREATED, expectVerdict, tokenFor, type World } from '@support/authz';
import { knownBug } from '@support/known-bug';
import type { Product } from '@support/toolshop-api';

/**
 * Authorisation of the API itself, below the UI: who may call what. This file: Writes to the catalogue: who may create, change or delete a brand, a category or a product.
 * (The authorization-*.spec.ts files are one suite, split by concern; the conventions they share, which statuses count as a refusal,
 * what is cleaned up and what is left behind, are stated once in `@support/authz`.)
 */
const test = mergeTests(apiOnlyTest, worldTest);

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

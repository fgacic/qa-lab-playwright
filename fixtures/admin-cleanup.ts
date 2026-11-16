import { randomUUID } from 'node:crypto';
import type { Request } from '@playwright/test';
import { apiPath } from '@support/env';
import type { Product, ToolshopApi } from '@support/toolshop-api';
import { test as adminTokenTest } from './admin-token';

/**
 * - `mocked`: a fake admin JWT and a mocked back office (fixtures/admin.ts). Runs everywhere and never
 *   touches the real admin API: unmocked writes are refused and fail the test.
 * - `storage-state`: the real admin saved by tests/setup/admin.setup.ts (`admin` project).
 */
export type AdminSession = 'mocked' | 'storage-state';

/**
 * Products the page created through the real API, watched from the requests and responses
 * themselves (a timed-out wait in the test cannot leak one) and deleted when the test ends, pass or
 * fail. A test that creates a product asks for it by name; it does nothing in the mocked session (whose
 * "created" product is a real catalogue record). It is not automatic: an auto fixture would add a listener and a
 * teardown to every test of the suite, for the few that create anything.
 * A product the UI deleted is dropped from the list as soon as its DELETE succeeds.
 */
export interface CreatedProducts {
  /** The ids created and not yet deleted. */
  pending(): string[];
}

/**
 * Users the back office's form is about to create on the real backend, removed when the test ends. The test names the email
 * before it acts (`track`); teardown looks the account up by that exact email, so a user whose create response was never read, or
 * one the API accepted although the form says otherwise (ADM-20 once fixed), is removed too and the shop's user list never grows.
 */
export interface CreatedUsers {
  track(email: string): void;
}

/** Brands arranged through the admin API for a real-backend test, and removed when it ends (by slug, so a copy the UI made goes too). */
export interface BrandFactory {
  create(): Promise<{ id: string; name: string; slug: string }>;
}

export interface CleanupFixtures {
  adminSession: AdminSession;
  createdProducts: CreatedProducts;
  createdUsers: CreatedUsers;
  brandFactory: BrandFactory;
}

/**
 * The cleanup fixtures (`createdProducts`, `createdUsers`, `brandFactory`) run their teardown after the test body, pass or fail.
 * A pin wrapped in `knownBug` is `test.fail`, which accepts ANY failure, a teardown one included: under `VERIFY_BUGS=1`
 * (scripts/verify-bugs.mjs) a pin whose cleanup failed is reported as failing "for another reason", not as reproducing its
 * defect, so a leak cannot hide behind an expected failure there.
 */
export const test = adminTokenTest.extend<CleanupFixtures>({
  adminSession: ['mocked', { option: true }],
  createdProducts: async ({ page, api, adminToken, adminSession }, use) => {
    if (adminSession !== 'storage-state') {
      await use({ pending: () => [] });
      return;
    }
    const pending = new Set<string>();
    const reads: Promise<void>[] = [];
    // Names of products whose create request went out and whose id is not (yet) known: no response, a response
    // that could not be read, or one still in flight. Their ids cannot be reached, so teardown looks them up by
    // name, by walking the catalogue (the shop's search drops words under 3 letters, BUG-28, so it cannot find
    // "Set of ..."). The names are unique per test, which is why this is not a sweep by the "QaLab" prefix:
    // another worker's product, created at that moment, would match it too.
    const unaccounted = new Set<string>();
    // On the context, like the mock layer: a product created from a second tab is watched too.
    const context = page.context();
    context.on('request', (request) => {
      if (request.method() !== 'POST' || apiPath(request.url()) !== '/products') return;
      const name = postedName(request);
      if (name) unaccounted.add(name);
    });
    context.on('response', (response) => {
      const request = response.request();
      const method = request.method();
      const pathname = apiPath(response.url());
      if (method === 'POST' && pathname === '/products') {
        const name = postedName(request);
        if (!response.ok()) {
          if (name) unaccounted.delete(name); // refused: nothing was created
          return;
        }
        // Read at once: the id is the only handle teardown has on the product. A body that cannot be read (the page navigated
        // away first) or carries no id leaves the name in `unaccounted`, and the by-name lookup in teardown decides whether
        // the product leaked; only a product with no name to look up is a cleanup failure.
        const read = response.json().then(
          (body: { id?: string }) => {
            if (!body.id) throw new Error('A create response carried no product id.');
            pending.add(body.id);
            if (name) unaccounted.delete(name);
          },
        ).catch((error: unknown) => {
          if (!name) throw new Error(`A product was created with no name to find it by, and its id could not be read, so it cannot be cleaned up: ${String(error)}`);
        });
        read.catch(() => undefined); // reported in teardown; this only keeps the rejection from going unhandled meanwhile
        reads.push(read);
      } else if (method === 'DELETE' && /^\/products\/[^/]+$/.test(pathname) && response.ok()) {
        pending.delete(pathname.split('/').pop()!);
      }
    });
    await use({ pending: () => [...pending] });

    // Clean up everything that can be reached, whatever else fails, then report every failure at once.
    const failures: unknown[] = (await Promise.allSettled(reads)).flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    const outcomes = await Promise.allSettled([
      ...[...pending].map(async (id) => api.deleteProduct(await adminToken(), id)),
      ...[...unaccounted].map(async (name) => {
        const leaked = await findInCatalogue(api, name);
        if (leaked) await api.deleteProduct(await adminToken(), leaked.id);
      }),
    ]);
    failures.push(...outcomes.flatMap((r) => (r.status === 'rejected' ? [r.reason] : [])));
    if (failures.length) throw new AggregateError(failures, `Cleaning up the products this test created failed ${failures.length} time(s)`);
  },
  createdUsers: async ({ api, adminToken, adminSession }, use) => {
    const emails = new Set<string>();
    await use({ track: (email) => void emails.add(email) });
    if (adminSession !== 'storage-state') return; // the mocked back office creates nothing real
    // Every removal is attempted whatever the others do, and every failure is reported at once, like the product cleanup.
    const outcomes = await Promise.allSettled([...emails].map(async (email) => {
      const token = await adminToken();
      const user = await api.findUserByEmail(token, email);
      if (user) await api.deleteUser(token, user.id);
    }));
    const failures = outcomes.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
    if (failures.length) throw new AggregateError(failures, 'Cleaning up the users this test created failed');
  },
  brandFactory: async ({ api, adminToken, adminSession }, use) => {
    const made = new Set<string>(); // slugs, so a brand the UI saved under the same slug is removed as well
    await use({
      async create() {
        // Like `createdProducts` and `createdUsers`, it never touches the real API in the mocked session: that session has its own mocked brand (`A.brand`).
        if (adminSession !== 'storage-state') throw new Error("brandFactory arranges real brands: it needs adminSession 'storage-state' (the mocked back office serves A.brand).");
        const suffix = randomUUID().slice(0, 8);
        const brand = { name: `QaLab Brand ${suffix}`, slug: `qalab-brand-${suffix}` };
        made.add(brand.slug);
        return api.createBrand(await adminToken(), brand);
      },
    });
    if (!made.size) return;
    // The sign-in is part of the cleanup: a login that fails is reported with the removals, not thrown past them.
    // Every removal is attempted whatever the others do, and every failure is reported at once, like the product cleanup.
    const [outcome] = await Promise.allSettled([(async () => removeBrands(api, made, await adminToken()))()]);
    const failures = outcome.status === 'rejected' ? [outcome.reason] : outcome.value;
    if (failures.length) throw new AggregateError(failures, 'Cleaning up the brands this test created failed');
  },
});

/** Removes the brands with these slugs (the shop's brand list has no search), attempting every one and returning every failure. */
async function removeBrands(api: ToolshopApi, slugs: ReadonlySet<string>, token: string): Promise<unknown[]> {
  const brands = await api.listBrands();
  const removals = await Promise.allSettled(brands.filter(({ slug }) => slugs.has(slug)).map(({ id }) => api.deleteBrand(token, id)));
  return removals.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
}

/** The name a create request carries. A body that is missing or not JSON yields no name instead of throwing inside a page listener. */
function postedName(request: Request): string | undefined {
  try {
    const name = (request.postDataJSON() as { name?: unknown } | null)?.name;
    return typeof name === 'string' ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The product with exactly this name, found by walking the catalogue page by page, in the default list and in the
 * rentals the default list leaves out. Slow, and only for a product whose id never reached the test; it proves the
 * product is not there when it returns nothing.
 */
async function findInCatalogue(api: ToolshopApi, name: string): Promise<Product | undefined> {
  for (const query of [{}, { is_rental: 'true' }]) {
    for (let page = 1; ; page++) {
      const result = await api.listProducts({ ...query, page: String(page) });
      const found = result.data.find((product) => product.name === name);
      if (found) return found;
      if (page >= result.last_page) break;
    }
  }
  return undefined;
}

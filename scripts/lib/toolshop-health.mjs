// What "the self-hosted Toolshop is up" means, in one place: scripts/wait-for-toolshop.mjs (after `toolshop:up`)
// and the suite's preflight (src/support/preflight.ts, before the first test) both use it.

/** A hung socket must not stall a loop past its deadline: every call has its own limit. */
const get = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(5000) });

/**
 * One look at the shop: the API lists products and the UI serves its index. Resolves to 'ok' or the reason it is not ready.
 * Does not sign in: that is `signInOnce`, run after this succeeds, so a shop that is still starting is polled with plain reads
 * and the seeded admin's login (which the API throttles after repeated failures) is attempted exactly once.
 */
export async function probe({ api, ui }) {
  const products = await get(`${api}/products`, { method: 'QUERY', headers: { 'content-type': 'application/json' }, body: '{"page":"1"}' });
  // `!(total >= 1)`, not `total < 1`: an answer with no usable `total` (undefined, null, a string) is an unseeded shop too.
  if (!products.ok || !((await products.json()).total >= 1)) return 'API has no products yet';
  const page = await get(ui);
  if (!page.ok || !(await page.text()).includes('<app-root')) return 'UI not serving the app';
  return 'ok';
}

/** Signs the seeded admin in once: proves the seed ran and the auth stack works. Resolves to 'ok' or the reason it did not. */
export async function signInOnce({ api, admin }) {
  const login = await get(`${api}/users/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(admin) });
  return login.ok ? 'ok' : `seeded admin cannot sign in (${login.status})`;
}

/** Polls `probe` until it says 'ok' or `timeoutMs` passes, then (when `admin` is given) signs in once. Resolves to 'ok' or the last reason. */
export async function waitForToolshop({ api, ui, admin, timeoutMs, intervalMs = 2000 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await probe({ api, ui }).catch((e) => e.cause?.code ?? e.message);
    if (state === 'ok') return admin ? signInOnce({ api, admin }).catch((e) => e.cause?.code ?? e.message) : 'ok';
    if (Date.now() > deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

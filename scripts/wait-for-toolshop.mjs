// Waits until the self-hosted Toolshop answers like a seeded shop: the API lists products and
// lets the seeded admin sign in, and the UI serves its index. Exits non-zero after the deadline.
const API = process.env.API_URL ?? 'http://localhost:4200/api';
const UI = process.env.BASE_URL ?? 'http://localhost:4200';
const deadline = Date.now() + Number(process.env.WAIT_TIMEOUT_MS ?? 180_000);

async function healthy() {
  const products = await fetch(`${API}/products`, { method: 'QUERY', headers: { 'content-type': 'application/json' }, body: '{"page":"1"}' });
  if (!products.ok || (await products.json()).total < 1) return 'API has no products yet';
  const login = await fetch(`${API}/users/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@practicesoftwaretesting.com', password: 'welcome01' }),
  });
  if (!login.ok) return `seeded admin cannot sign in (${login.status})`;
  const ui = await fetch(UI);
  if (!ui.ok || !(await ui.text()).includes('<app-root')) return 'UI not serving the app';
  return 'ok';
}

for (;;) {
  const state = await healthy().catch((e) => e.cause?.code ?? e.message);
  if (state === 'ok') {
    console.log(`Toolshop is up: UI ${UI}, API ${API}`);
    process.exit(0);
  }
  if (Date.now() > deadline) {
    console.error(`Toolshop did not become healthy: ${state}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}

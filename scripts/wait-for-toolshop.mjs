// Waits until the self-hosted Toolshop answers like a seeded shop: the API lists products and the UI serves its
// index (polled with plain reads), then the seeded admin signs in once (never in the loop: the API throttles repeated
// failed logins). Exits non-zero after the deadline. The check itself is scripts/lib/toolshop-health.mjs.
import { readFileSync } from 'node:fs';
import { waitForToolshop } from './lib/toolshop-health.mjs';

// The seeded accounts live in one place, shared with src/support/env.ts.
const { admin } = JSON.parse(readFileSync(new URL('../src/support/seeded-accounts.json', import.meta.url), 'utf8'));
const api = process.env.API_URL ?? 'http://localhost:4200/api';
const ui = process.env.BASE_URL ?? 'http://localhost:4200';

const state = await waitForToolshop({ api, ui, admin, timeoutMs: Number(process.env.WAIT_TIMEOUT_MS ?? 180_000) });
if (state !== 'ok') {
  console.error(`Toolshop did not become healthy: ${state}`);
  process.exit(1);
}
console.log(`Toolshop is up: UI ${ui}, API ${api}`);

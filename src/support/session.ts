import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { COMPARE_STORAGE_KEY } from '@pages/ComparisonPage';

/** The localStorage key the SPA keeps its JWT under. */
export const TOKEN_KEY = 'auth-token';

/**
 * The SPA reads its JWT from localStorage[TOKEN_KEY]. Installed once per tab, so that
 * signing out (which clears it and reloads) really signs the user out.
 */
export async function installToken(page: Page, token: string): Promise<void> {
  // On the context, so a second tab the test opens (a popup, `context.newPage()`) is signed in the same way.
  // The per-tab sessionStorage flag keeps the "install once" rule: a reload or a sign-out in that tab stays signed out.
  await page.context().addInitScript(
    ({ key, token }) => {
      // Opaque frames (sandboxed iframes, about:blank children) have no storage: reading it throws a SecurityError, and they hold no SPA to sign in.
      if (location.origin === 'null') return;
      if (sessionStorage.getItem('qa-lab-token-installed')) return;
      sessionStorage.setItem('qa-lab-token-installed', '1');
      localStorage.setItem(key, token);
    },
    { key: TOKEN_KEY, token },
  );
}

/**
 * Puts a cart made through the API in this tab's session storage, where the SPA keeps its cart, before the tab's first page script runs.
 * Once per tab: a cart the app deletes later (after an order) is not brought back on the next navigation.
 */
export async function seedTabCart(page: Page, cartId: string, quantity: number): Promise<void> {
  await page.addInitScript(
    ({ cartId, quantity }) => {
      if (sessionStorage.getItem('qa-lab-cart-seeded')) return;
      sessionStorage.setItem('qa-lab-cart-seeded', '1');
      sessionStorage.setItem('cart_id', cartId);
      sessionStorage.setItem('cart_quantity', String(quantity));
    },
    { cartId, quantity },
  );
}

/** Puts the products selected for comparison (as the comparison bar leaves them) in this tab's session storage, unless the tab already holds a selection. */
export async function seedTabComparison(page: Page, ids: string[]): Promise<void> {
  await page.addInitScript(
    ({ ids, key }) => {
      if (ids.length && !sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(ids));
    },
    { ids, key: COMPARE_STORAGE_KEY },
  );
}

/** The JWT the SPA currently holds in localStorage, or null when signed out. Poll it: `await expect.poll(() => storedToken(page)).toBeTruthy()`. */
export function storedToken(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
}

/** The token a saved storageState file holds. Read from the file: the SPA drops an expired one as soon as a page opens. */
export function readSavedToken(storageStatePath: string): string {
  const state = JSON.parse(readFileSync(storageStatePath, 'utf8')) as { origins: { localStorage: { name: string; value: string }[] }[] };
  const token = state.origins.flatMap((origin) => origin.localStorage).find((item) => item.name === TOKEN_KEY)?.value;
  if (!token) throw new Error(`${storageStatePath} holds no "${TOKEN_KEY}": the setup did not save a session.`);
  return token;
}

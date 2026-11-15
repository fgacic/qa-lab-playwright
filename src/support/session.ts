import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** The localStorage key the SPA keeps its JWT under. */
export const TOKEN_KEY = 'auth-token';

/**
 * The SPA reads its JWT from localStorage[TOKEN_KEY]. Installed once per tab, so that
 * signing out (which clears it and reloads) really signs the user out.
 */
export async function installToken(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ({ key, token }) => {
      if (sessionStorage.getItem('qa-lab-token-installed')) return;
      sessionStorage.setItem('qa-lab-token-installed', '1');
      localStorage.setItem(key, token);
    },
    { key: TOKEN_KEY, token },
  );
}

/** The token a saved storageState file holds. Read from the file: the SPA drops an expired one as soon as a page opens. */
export function readSavedToken(storageStatePath: string): string {
  const state = JSON.parse(readFileSync(storageStatePath, 'utf8')) as { origins: { localStorage: { name: string; value: string }[] }[] };
  const token = state.origins.flatMap((origin) => origin.localStorage).find((item) => item.name === TOKEN_KEY)?.value;
  if (!token) throw new Error(`${storageStatePath} holds no "${TOKEN_KEY}": the setup did not save a session.`);
  return token;
}

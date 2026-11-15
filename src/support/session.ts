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

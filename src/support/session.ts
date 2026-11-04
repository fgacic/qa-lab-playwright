import type { Page } from '@playwright/test';

/**
 * The SPA reads its JWT from localStorage["auth-token"]. Installed once per tab, so that
 * signing out (which clears it and reloads) really signs the user out.
 */
export async function installToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((token) => {
    if (sessionStorage.getItem('qa-lab-token-installed')) return;
    sessionStorage.setItem('qa-lab-token-installed', '1');
    localStorage.setItem('auth-token', token);
  }, token);
}

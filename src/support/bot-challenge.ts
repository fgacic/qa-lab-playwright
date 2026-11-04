import { test, type Page } from '@playwright/test';
import { TARGET } from './env';

/**
 * Cloudflare in front of the live site answers some navigations from datacenter IPs (GitHub's
 * runners) with a managed bot challenge instead of the shop. The suite never tries to solve or
 * get around it. A test whose own navigation lands on the challenge is skipped with this reason,
 * and any test the challenge interrupts is annotated (fixtures/bot-challenge.ts), so the live
 * report tells environmental noise from shop behaviour.
 */
export const BOT_CHALLENGE_REASON = 'Cloudflare bot challenge on the live site (not bypassed by design).';

export function isBotChallenge(url: string): boolean {
  return url.includes('__cf_chl');
}

/** Call right after a navigation the test itself made. */
export async function skipIfBotChallenge(page: Page): Promise<void> {
  if (TARGET !== 'live') return;
  const challenged = isBotChallenge(page.url()) || (await page.title().catch(() => '')) === 'Just a moment...';
  test.skip(challenged, BOT_CHALLENGE_REASON);
}

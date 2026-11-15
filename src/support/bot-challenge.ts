import { test, type Page } from '@playwright/test';
import { TARGET } from './env';

/**
 * Cloudflare in front of the live site answers some navigations from datacenter IPs (GitHub's
 * runners) with a managed bot challenge instead of the shop. The suite never tries to solve or
 * get around it. A test whose own navigation lands on the challenge is skipped with this reason
 * (and counted, see below), and any test the challenge interrupts is annotated (fixtures/bot-challenge.ts), so the live
 * report tells environmental noise from shop behaviour.
 */
export const BOT_CHALLENGE_REASON = 'Cloudflare bot challenge on the live site (not bypassed by design).';

/**
 * A runtime skip alone would let a fully challenged live run end green with everything skipped.
 * The run-guard reporter (src/support/run-guard-reporter.ts) counts the tests skipped with the
 * reason above and fails the run when more than this share of them was.
 */
export const MAX_BOT_CHALLENGE_SKIP_RATIO = 0.2;

export function isBotChallenge(url: string): boolean {
  return url.includes('__cf_chl');
}

/** Call right after a navigation the test itself made. */
export async function skipIfBotChallenge(page: Page): Promise<void> {
  if (TARGET !== 'live') return;
  const challenged = isBotChallenge(page.url()) || (await page.title().catch(() => '')) === 'Just a moment...';
  test.skip(challenged, BOT_CHALLENGE_REASON);
}

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

/** A challenge page's URL carries Cloudflare's `__cf_chl` token. */
export function isBotChallenge(url: string): boolean {
  return url.includes('__cf_chl');
}

/** Cloudflare marks a challenged response with `cf-mitigated: challenge`, whatever URL and title the page then shows. */
export function isChallengeResponse(response: { headers(): Record<string, string> }): boolean {
  return response.headers()['cf-mitigated']?.toLowerCase() === 'challenge';
}

/** Pages whose own navigation was answered with a challenge response; filled by fixtures/bot-challenge.ts, read by `skipIfBotChallenge`. */
export const challengedPages = new WeakSet<Page>();

/**
 * Skips the test when this response (a `request.get` the test made, with no page behind it) is a Cloudflare challenge.
 * Live runs only; the same runtime skip as `skipIfBotChallenge`, counted and bounded by the run-guard reporter.
 */
export function skipIfChallengedResponse(response: { headers(): Record<string, string> }): void {
  if (TARGET !== 'live') return;
  skipForChallenge(isChallengeResponse(response));
}

/**
 * Call right after a navigation the test itself made. Pass the response of that navigation (`page.goto`'s result, or a
 * `request.get`'s) when you have it: the challenge is then recognised by its header as well as by the URL and the title.
 */
export async function skipIfBotChallenge(page: Page, response?: { headers(): Record<string, string> } | null): Promise<void> {
  if (TARGET !== 'live') return;
  skipForChallenge(
    challengedPages.has(page) ||
      (!!response && isChallengeResponse(response)) ||
      isBotChallenge(page.url()) ||
      (await page.title().catch(() => '')) === 'Just a moment...',
  );
}

/** The one runtime skip the suite allows: an environmental block, counted and bounded by the run-guard reporter. */
function skipForChallenge(challenged: boolean): void {
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(challenged, BOT_CHALLENGE_REASON);
}

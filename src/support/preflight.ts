import type { FullConfig } from '@playwright/test';
import { waitForToolshop } from '../../scripts/lib/toolshop-health.mjs';
import { API_URL, BASE_URL, IS_SELF_HOSTED } from './env';

/**
 * `globalSetup`: refuses to start a run against a target that is not answering, with one clear message instead of
 * hundreds of identical timeouts. The self-hosted shop is waited for briefly (a container that was just started);
 * the live site is asked once, and any HTTP answer counts, a Cloudflare challenge page included: judging that is
 * the bot-challenge guard's job, not this one's.
 */
export default async function preflight(_config: FullConfig): Promise<void> {
  if (IS_SELF_HOSTED) {
    const state = await waitForToolshop({ api: API_URL, ui: BASE_URL, timeoutMs: Number(process.env.PREFLIGHT_TIMEOUT_MS ?? 30_000), intervalMs: 1000 });
    if (state !== 'ok') throw new Error(`The self-hosted Toolshop at ${BASE_URL} is not ready (${state}). Start it with \`npm run toolshop:up\`.`);
    return;
  }
  for (const url of [BASE_URL, API_URL]) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw new Error(`${url} is not reachable (${(error as Error).cause ?? (error as Error).message}): nothing to run the suite against.`, { cause: error });
    }
  }
}

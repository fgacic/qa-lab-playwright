import type { Page, Request } from '@playwright/test';

/** What a page cost to load: how many requests it made and how many bytes came over the wire, in total and for scripts alone. */
export interface PageWeight {
  requests: number;
  /** Response headers plus response body, as sent (the container's nginx does not compress, see docker/ui-nginx.conf). */
  bytes: number;
  /** The same for the page's scripts: the bundle is what grows silently. */
  scriptBytes: number;
  /** The five heaviest responses, largest first, so a failing budget says what to look at. */
  heaviest: { url: string; bytes: number }[];
}

/**
 * Loads a page the way a first visit does and counts what came over the wire. The browser's cache is switched off for it (through the
 * DevTools protocol, so Chromium only), because a reload served from cache would weigh nothing; every request that finished while
 * `visit` ran is counted, and the visit must end on something that is only there once the page has drawn, so images the first
 * view needs are in the count.
 *
 * Bytes come from `Request.sizes()` (headers and body as transferred), never from a page script, and a request that failed is not counted:
 * nothing came back for it.
 */
export async function measurePageWeight(page: Page, visit: () => Promise<void>): Promise<PageWeight> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const sizes: Promise<{ url: string; type: string; bytes: number }>[] = [];
  const onFinished = (request: Request) => {
    if (request.url().startsWith('data:')) return;
    sizes.push(request.sizes().then(({ responseBodySize, responseHeadersSize }) => ({ url: request.url(), type: request.resourceType(), bytes: responseBodySize + responseHeadersSize })));
  };
  page.on('requestfinished', onFinished);
  try {
    await visit();
  } finally {
    page.off('requestfinished', onFinished);
    await cdp.detach();
  }
  const responses = await Promise.all(sizes);
  const sum = (items: { bytes: number }[]) => items.reduce((total, { bytes }) => total + bytes, 0);
  return {
    requests: responses.length,
    bytes: sum(responses),
    scriptBytes: sum(responses.filter(({ type }) => type === 'script')),
    heaviest: [...responses].sort((a, b) => b.bytes - a.bytes).slice(0, 5).map(({ url, bytes }) => ({ url, bytes })),
  };
}

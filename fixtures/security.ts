import { expect, test as base, type Page } from '@playwright/test';
import { ContactPage } from '@pages/ContactPage';

/**
 * Injection payloads, typed into forms as plain text; the specs then check the text comes back as
 * text. Each one calls `__qaLabXssHit`, a function the sentinel exposes to the page, so running
 * it is recorded whether or not it opens a dialog (a payload that fetches, writes to the DOM or
 * redirects is caught the same way). All are under 40 characters, the longest search the shop
 * accepts (BUG-27). The number it passes says which one ran.
 */
export const XSS_PAYLOADS = {
  'img onerror': `<img src=x onerror=__qaLabXssHit(1)>`,
  'script tag': `<script>__qaLabXssHit(2)</script>`,
  'svg onload, breaking out of an attribute': `"><svg onload=__qaLabXssHit(3)>`,
} as const;
export type XssPayload = (typeof XSS_PAYLOADS)[keyof typeof XSS_PAYLOADS];

/**
 * The same three attacks, for the address bar. They call the hook as a tagged template
 * (a name followed by a backtick string) instead of with parentheses: Angular's router reads
 * `(...)` in a URL as a secondary outlet, so a payload with a call in it is redirected home before
 * the page ever sees it. The number it passes still says which one ran.
 */
export const ROUTE_XSS_PAYLOADS = {
  'img onerror': '<img src=x onerror=__qaLabXssHit`4`>',
  'script tag': '<script>__qaLabXssHit`5`</script>',
  'svg onload, breaking out of an attribute': '"><svg onload=__qaLabXssHit`6`>',
} as const;

/**
 * How long a negative result is observed before it is believed. "Nothing ran" cannot be polled
 * for like a visible element: it is true the instant the page is quiet, and also true a moment
 * before a handler fires. So `expectNotExecuted` first waits for what a payload hangs on to
 * settle (every image has loaded or failed, two timer turns have passed) and then keeps sampling
 * for this long. It is only ever paid on a passing test; a hit fails it at once.
 */
const OBSERVATION_WINDOW_MS = 1_000;

declare global {
  interface Window {
    __qaLabXssHit: (kind: string) => void;
  }
}

/**
 * Records every sign that page script ran: a call to `__qaLabXssHit` (what the payloads do) and
 * any alert, confirm or prompt (what a payload written by hand would reach for). Installed on
 * the whole browser context before the first navigation, so it covers every frame, popup and tab
 * the page opens, and kept on the Node side, so a hit survives the page navigating away.
 * `executions()` reports what ran anywhere in the context; the DOM checks look at the page the
 * test drives.
 */
export class XssSentinel {
  private readonly hits: string[] = [];

  constructor(private readonly page: Page, private readonly watching: boolean) {}

  async install(): Promise<void> {
    const context = this.page.context();
    await context.exposeFunction('__qaLabXssHit', (kind: string) => void this.hits.push(String(kind)));
    await context.addInitScript(() => {
      for (const name of ['alert', 'confirm', 'prompt'] as const) {
        window[name] = ((message?: unknown) => {
          window.__qaLabXssHit(`${name}: ${String(message)}`);
          return name === 'confirm' ? false : name === 'prompt' ? null : undefined;
        }) as never;
      }
    });
    // A dialog the wrapper missed (opened by a frame created before it, say) must not hang the page.
    context.on('dialog', async (dialog) => {
      this.hits.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });
  }

  /** What ran so far, in order. */
  executions(): readonly string[] {
    return this.hits;
  }

  /** Waits until nothing a payload could still be waiting on is pending, then returns. */
  private async settle(): Promise<void> {
    await this.page.evaluate(async () => {
      // Lazy images below the fold may never load, so they are not waited for.
      const pending = [...document.images].filter((image) => !image.complete && image.loading !== 'lazy');
      await Promise.all(pending.map((image) => new Promise((done) => (image.onload = image.onerror = done))));
      // Timers, not animation frames: a page in a background tab (parallel Firefox) never gets a frame.
      await new Promise((tick) => setTimeout(tick, 0));
      await new Promise((tick) => setTimeout(tick, 0));
    });
  }

  /**
   * The negative check: nothing a payload could do has been seen, after the observation window.
   * This is the one that waits; `expectNoInjectedElements` is a snapshot, so call it first and
   * this last.
   */
  async expectNotExecuted(): Promise<void> {
    expect(this.watching, 'the sentinel is not installed: add test.use({ xssWatch: true }) to the spec').toBe(true);
    await this.settle();
    const started = Date.now();
    await expect
      .poll(() => (this.hits.length ? [...this.hits] : Date.now() - started >= OBSERVATION_WINDOW_MS ? [] : ['still observing']), {
        message: 'script ran on the page (the sentinel recorded these calls)',
        intervals: [100],
        timeout: OBSERVATION_WINDOW_MS + 3_000,
      })
      .toEqual([]);
  }

  /**
   * How many elements a payload would have created had it been parsed as HTML. Read from the DOM
   * rather than by locator: Playwright's text matching ignores the body of a <script>.
   */
  async injectedCount(): Promise<number> {
    return this.page.evaluate(
      () => document.querySelectorAll('img[src="x"], svg[onload*="__qaLabXssHit"]').length + [...document.scripts].filter((s) => s.textContent?.includes('__qaLabXssHit')).length,
    );
  }

  /** A snapshot: it passes the instant the DOM holds no parsed payload and says nothing about what is still to run. */
  async expectNoInjectedElements(): Promise<void> {
    await expect.poll(() => this.injectedCount(), { message: 'a payload was parsed into elements' }).toBe(0);
  }
}

export interface SecurityFixtures {
  /**
   * Opt in with `test.use({ xssWatch: true })`. An option, so the sentinel (an auto fixture) is
   * in place before any page fixture navigates; it replaces alert/confirm/prompt, which other
   * specs rely on, so it is not installed everywhere.
   */
  xssWatch: boolean;
  xss: XssSentinel;
  /** The contact page, opened by somebody else: a browser context of their own with nobody signed in. */
  visitorContactPage: ContactPage;
}

export const test = base.extend<SecurityFixtures>({
  xssWatch: [false, { option: true }],
  xss: [
    async ({ page, xssWatch }, use) => {
      const sentinel = new XssSentinel(page, xssWatch);
      if (xssWatch) await sentinel.install();
      await use(sentinel);
    },
    { auto: true },
  ],
  visitorContactPage: async ({ browser, baseURL }, use) => {
    const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    const contactPage = new ContactPage(await visitor.newPage());
    await contactPage.open();
    await use(contactPage);
    await visitor.close();
  },
});

import { expect, mergeTests, type BrowserContext, type Page } from '@playwright/test';
import { ContactPage } from '@pages/ContactPage';
import { HomePage } from '@pages/HomePage';
import { IS_SELF_HOSTED } from '@support/env';
import type { World } from '@support/authz';
import { test as adminTokenTest } from './admin-token';
import { cleanupTest } from './cleanups';

/**
 * Injection payloads, typed into forms as plain text; the specs then check the text comes back as
 * text. Each one calls `__qaLabXssHit`, a function the sentinel exposes to the page, so running
 * it is recorded whether or not it opens a dialog (a payload that fetches, writes to the DOM or
 * redirects is caught the same way). Each is at most 40 characters, the longest search the shop
 * accepts (BUG-27), so one can be searched for. The number it passes says which one ran.
 *
 * Caveat shared by every payload that uses `<img src=x>`: the DOM check (`injectedCount`) recognises a parsed payload by the
 * attribute `src="x"`, so a payload that used another source would go uncounted, and a genuine image whose source is
 * exactly "x" would be counted wrongly. The sentinel's own hit record does not depend on it, which is why both checks are made.
 */
export const XSS_PAYLOADS = {
  'img onerror': `<img src=x onerror=__qaLabXssHit(1)>`,
  'script tag': `<script>__qaLabXssHit(2)</script>`,
  'svg onload, breaking out of an attribute': `"><svg onload=__qaLabXssHit(3)>`,
} as const;
/** The longest term the shop's search box acts on: a longer one is silently dropped, no request and no message (BUG-27). */
export const MAX_SEARCH_TERM = 40;
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
 * A payload for a value that lands in an HTML attribute (an `alt`, a `title`, an `href`, an input's `value`), with the sink it
 * is the control for: what a vulnerable page would build from it. Each calls `__qaLabXssHit`, so a hit says which one ran.
 * - quote break: closes the quote and adds a handler of its own, with no angle bracket, which is what a filter that only strips
 *   tags lets through; `autofocus` is what makes it run without a click (the control focuses the element itself, see
 *   `insertInAttributeSink`);
 * - srcdoc: the same break, adding a `srcdoc` to an iframe, whose script the browser runs;
 * - `javascript:` URL: a value that is itself the whole URL of a link, which runs when the link is followed (`activate`);
 * - entity-encoded: the quote arrives as `&quot;` and a sink that decodes entities before it builds the attribute turns it into a real one.
 * These are longer than the payloads above (up to 51 characters: they need a quote, a handler and the closing quote of the sink), so only
 * the ones that fit the search box's 40 characters (BUG-27) can be searched for, and the first name cap (also 40) rules the rest out as a first name.
 */
export interface AttributePayload {
  payload: string;
  /** The markup a vulnerable page would build around the value. */
  sink: (value: string) => string;
  /** Whether the payload only runs once the sink's link is followed. */
  activate?: 'click';
  /** What a safe page puts in the sink instead (the control): escaping for a text attribute, a scheme check for a URL. */
  neutralise: (value: string) => string;
}
const escapeAttribute = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const ATTRIBUTE_XSS_PAYLOADS: Record<string, AttributePayload> = {
  'a quote that adds a focus handler': { payload: '" autofocus onfocus=__qaLabXssHit(7) x="', sink: (value) => `<input value="${value}">`, neutralise: escapeAttribute },
  'a quote that adds a srcdoc': { payload: '" srcdoc="<script>__qaLabXssHit(8)</script>" x="', sink: (value) => `<iframe title="${value}"></iframe>`, neutralise: escapeAttribute },
  'a javascript: URL': { payload: 'javascript:__qaLabXssHit(9)', sink: (value) => `<a href="${value}">link</a>`, activate: 'click', neutralise: (value) => `#${encodeURIComponent(value)}` },
  'an entity-encoded quote': {
    payload: '&quot; autofocus onfocus=__qaLabXssHit(10) x=&quot;',
    // A sink that decodes entities before it puts the text in the attribute: the one place `&quot;` becomes a quote.
    sink: (value) => `<input value="${value.replaceAll('&quot;', '"')}">`,
    neutralise: escapeAttribute,
  },
};

/**
 * The hit ids of the sentinel's own controls (tests/security/xss-sentinel.spec.ts). The payloads above use 1 to 10, so a control takes the
 * next numbers: a hit from a payload can never be mistaken for a control's, nor the other way round. A new payload takes the next free number.
 */
export const SENTINEL_CONTROL_HIT = { shadowRoot: 11, frame: 12 } as const;

/**
 * How long a negative result is observed before it is believed. "Nothing ran" cannot be polled
 * for like a visible element: it is true the instant the page is quiet, and also true a moment
 * before a handler fires. So `expectNotExecuted` first waits for what a payload hangs on to
 * settle (every image has loaded or failed, two timer turns have passed) and then watches
 * for this long, racing the window against the sentinel's hit signal. It is only ever paid on a
 * passing test; a hit ends the wait at once and fails it. The settle step covers every page of every watched context
 * (the test's own, a visitor's, a popup, a second tab); the DOM snapshots (`injectedCount`) read the page the test drives.
 * The window is 1 s because what a payload can still do after the page settled is a timer or a handler on a load
 * that has already finished, which fire within a task or two; a handler that waits longer than the window is not covered. That is the
 * blind spot of every "nothing ran" check here: a payload that fires its script after more than a second (a long timer, a slow
 * network call it starts itself) is not seen, so a pass says "nothing ran inside the window", not "nothing can ever run".
 */
export const OBSERVATION_WINDOW_MS = 1_000;

/** How many times `settle` starts over on a page that was navigated away from while it waited. */
const SETTLE_ATTEMPTS = 3;
/**
 * What Chromium says when a page is navigated while a script runs in it (the only engine this runs in: the sentinel is Chromium-only).
 * Matched by text, as Playwright gives no error class for it. A reworded message does not let a failure pass: the error is thrown on
 * instead of retried, so an upgrade that changes it shows up as a failing check, never a green one.
 */
const CONTEXT_DESTROYED = /execution context was destroyed/i;

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
  /** Resolves on the first recorded sign that script ran, so a negative check can stop watching the moment one arrives. */
  private signalHit!: () => void;
  private readonly firstHit = new Promise<'hit'>((resolve) => (this.signalHit = () => resolve('hit')));

  constructor(private readonly page: Page, private readonly watching: boolean) {}

  private readonly watched = new Set<BrowserContext>();

  /** Watches the page's own context. */
  async install(): Promise<void> {
    await this.watch(this.page.context());
  }

  /**
   * Puts the sentinel on a browser context, once. Every context a test opens (somebody else's, say) must be watched
   * too: a payload that runs for another visitor is a hit all the same, recorded here.
   */
  async watch(context: BrowserContext): Promise<void> {
    if (this.watched.has(context)) return;
    this.watched.add(context);
    await context.exposeFunction('__qaLabXssHit', (kind: string) => this.record(String(kind)));
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
      this.record(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });
  }

  private record(kind: string): void {
    this.hits.push(kind);
    this.signalHit();
  }

  /** Puts the HTML into a frame's `srcdoc`, which the browser parses as a document: what makes `<script>` and `<svg onload>` run. */
  async parseInFrame(html: string): Promise<void> {
    await this.page.evaluate((markup) => {
      const frame = document.createElement('iframe');
      frame.srcdoc = markup;
      document.body.append(frame);
    }, html);
  }

  /** Inserts the HTML into the page's body the way a vulnerable sink (`innerHTML`) would. */
  async insertHtml(html: string): Promise<void> {
    await this.page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html);
  }

  /**
   * Builds the markup a vulnerable sink would make from an attribute payload (`ATTRIBUTE_XSS_PAYLOADS`) and puts it in the page.
   * An element with `autofocus` is focused here, explicitly: whether a browser autofocuses an element inserted after load differs by
   * engine, and the control is about the sentinel seeing a handler run, not about the browser's focus rules. A link that needs following is clicked.
   */
  async insertInAttributeSink({ payload, sink, activate, neutralise }: AttributePayload, { safe = false }: { safe?: boolean } = {}): Promise<void> {
    // The control: the value is neutralised the way a safe page would, so the same sink must leave nothing to run or to count.
    const value = safe ? neutralise(payload) : payload;
    await this.page.evaluate(
      ([markup, follow]) => {
        const holder = document.createElement('div');
        holder.innerHTML = markup;
        document.body.append(holder);
        holder.querySelector<HTMLElement>('[autofocus]')?.focus();
        if (follow) holder.querySelector<HTMLElement>('a')?.click();
      },
      [sink(value), activate === 'click'] as const,
    );
  }

  /** Leaves one payload in an iframe's document and another in an open shadow root, the two places a plain query does not look. */
  async insertInFrameAndShadowRoot(framed: string, shadowed: string): Promise<void> {
    await this.page.evaluate(
      ([inFrame, inShadow]) => {
        const frame = document.createElement('iframe');
        document.body.append(frame);
        frame.contentDocument!.body.insertAdjacentHTML('beforeend', inFrame);
        const host = document.createElement('div');
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).innerHTML = inShadow;
      },
      [framed, shadowed],
    );
  }

  /** Calls `window.alert` as page script would, on this page or on another one of the context (a popup, a tab). */
  async raiseAlert(message: string, page: Page = this.page): Promise<void> {
    await page.evaluate((text) => window.alert(text), message);
  }

  /** Has the page open a popup to `path` (as page script would) and returns it once it has loaded. */
  async openPopup(path: string): Promise<Page> {
    const opened = this.page.waitForEvent('popup');
    await this.page.evaluate((target) => window.open(target, '_blank'), path);
    const popup = await opened;
    await popup.waitForLoadState('domcontentloaded');
    return popup;
  }

  /** What ran so far, in order. */
  executions(): readonly string[] {
    return this.hits;
  }

  /**
   * Waits until nothing a payload could still be waiting on is pending, then returns. A hit already recorded ends it
   * at once, and a navigation that destroys the page mid-wait is not an error: the wait starts over on the new document
   * (a few times at most), since a payload's handler may be what redirected it.
   */
  private async settleAll(): Promise<void> {
    const pages = [...this.watched].flatMap((context) => context.pages());
    await Promise.all((pages.includes(this.page) ? pages : [this.page, ...pages]).map((page) => this.settle(page)));
  }

  private async settle(page: Page): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      if (this.hits.length || page.isClosed()) return;
      try {
        await page.evaluate(async () => {
          // Lazy images below the fold may never load, so they are not waited for. The listeners are added, not assigned:
          // an `onerror` property is what an `<img onerror=...>` payload runs through, and replacing it would stop the very
          // handler this check exists to wait for.
          const pending = [...document.images].filter((image) => !image.complete && image.loading !== 'lazy');
          await Promise.all(
            pending.map((image) => new Promise((done) => (['load', 'error'] as const).forEach((type) => image.addEventListener(type, done, { once: true })))),
          );
          // Timers, not animation frames: a page in a background tab (parallel Firefox) never gets a frame.
          await new Promise((tick) => setTimeout(tick, 0));
          await new Promise((tick) => setTimeout(tick, 0));
        });
        return;
      } catch (error) {
        if (this.hits.length || page.isClosed()) return; // the page went away because something ran (or the test closed it): the expectation reports what
        if (!CONTEXT_DESTROYED.test(String(error)) || attempt >= SETTLE_ATTEMPTS - 1) throw error;
      }
    }
  }

  /**
   * The negative check: nothing a payload could do has been seen, after the observation window.
   * A negative cannot be proven by looking once, so the window is watched for real: it is raced
   * against the first hit, and a hit fails the check at once, naming what ran. This is the one that
   * waits; `expectNoInjectedElements` is a snapshot, so call it first and this last.
   */
  async expectNotExecuted(): Promise<void> {
    expect(this.watching, 'the sentinel is not installed: add test.use({ xssWatch: true }) to the spec').toBe(true);
    await this.settleAll();
    let timer: NodeJS.Timeout | undefined;
    // The window is a plain timer on purpose: this is the one place where the point is to let time pass, and the hit
    // signal ends it early. It never waits for a state to appear.
    const elapsed = new Promise<'quiet'>((resolve) => (timer = setTimeout(() => resolve('quiet'), OBSERVATION_WINDOW_MS)));
    try {
      await Promise.race([elapsed, this.firstHit]);
    } finally {
      clearTimeout(timer);
    }
    expect(this.hits, 'script ran on the page (the sentinel recorded these calls)').toEqual([]);
  }

  /**
   * How many elements a payload would have created had it been parsed as HTML, in the document, in every same-origin
   * iframe and in every open shadow root (a sink inside a component or a frame is a sink too). Read from the DOM
   * rather than by locator: Playwright's text matching ignores the body of a <script>. It recognises an
   * `<img>` payload by `src="x"`: see the caveat on XSS_PAYLOADS. A closed shadow root cannot be read from outside, and a
   * cross-origin frame cannot be entered: the sentinel's hit record is what covers those.
   */
  async injectedCount(page: Page = this.page): Promise<number> {
    return page.evaluate(() => {
      // Elements, not matches, so an `<img src=x onerror=hook>` that two of the rules recognise is one payload.
      const count = (root: Document | ShadowRoot): number => {
        const found = new Set<Element>(root.querySelectorAll('img[src="x"]'));
        for (const script of root.querySelectorAll('script')) if (script.textContent?.includes('__qaLabXssHit')) found.add(script);
        let nested = 0;
        for (const element of root.querySelectorAll('*')) {
          // Any attribute that runs the hook: an event handler (`onload` of an svg, `onfocus` of an element a quote was broken out of),
          // a `srcdoc` that carries it, or a `javascript:` URL.
          const runsHook = (attribute: Attr) =>
            attribute.value.includes('__qaLabXssHit') && (/^on/i.test(attribute.name) || attribute.name === 'srcdoc' || /^\s*javascript:/i.test(attribute.value));
          const framesHook = element instanceof HTMLIFrameElement && element.srcdoc.includes('__qaLabXssHit');
          if ([...element.attributes].some(runsHook)) found.add(element);
          if (element.shadowRoot) nested += count(element.shadowRoot);
          // A srcdoc frame is counted by its attribute: its document is the same payload, parsed, and would count twice.
          if (element instanceof HTMLIFrameElement && element.contentDocument && !framesHook) nested += count(element.contentDocument);
        }
        return found.size + nested;
      };
      return count(document);
    });
  }

  /** A snapshot: it passes the instant the DOM holds no parsed payload and says nothing about what is still to run. */
  async expectNoInjectedElements(page: Page = this.page): Promise<void> {
    await expect.poll(() => this.injectedCount(page), { message: 'a payload was parsed into elements' }).toBe(0);
  }
}

/**
 * `world`: what the helpers of @support/authz take (the request client, the API, the admin token, the cleanups) in one value, so a
 * spec passes `world` instead of rebuilding the same object in every test. For specs on the browserless `apiOnlyTest`: merge it in
 * with `mergeTests(apiOnlyTest, worldTest)`, which also brings `cleanups`.
 */
export const worldTest = mergeTests(adminTokenTest, cleanupTest).extend<{ world: World }>({
  world: async ({ request, api, adminToken, cleanups }, use) => {
    await use({ request, api, adminToken, cleanups });
  },
});

export interface SecurityFixtures {
  /**
   * Opt in with `test.use({ xssWatch: true })`. An option, so the sentinel (an auto fixture) is
   * in place before any page fixture navigates; it replaces alert/confirm/prompt, which other
   * specs rely on, so it is not installed everywhere.
   */
  xssWatch: boolean;
  xss: XssSentinel;
  /**
   * A browser context of somebody else: nobody signed in, no storage, watched like the test's own. Opens a page in it on every call;
   * the contexts are closed after the test. For a test that saves a payload as one user and must see it shown to another.
   * Self-hosted only: its users go on to submit and read real records.
   */
  newVisitor: () => Promise<Page>;
  /** The contact page as a visitor sees it: `newVisitor`'s page, on /contact. The visitor is the sender of a message; nothing here views anything as a victim. */
  visitorContactPage: ContactPage;
  /** The storefront home page as a visitor sees it: `newVisitor`'s page, not opened yet (the test opens it when what it shows has been made). Nobody is signed in. */
  visitorHomePage: HomePage;
}

export const test = cleanupTest.extend<SecurityFixtures>({
  xssWatch: [false, { option: true }],
  // Auto, though only the specs that opt in with `xssWatch` need it: the sentinel must be installed on the context
  // before any page fixture navigates, and Playwright orders only auto fixtures ahead of the ones a test names.
  // Left to be requested by name, a spec listing `homePage` before `xss` would open the page unwatched. With
  // `xssWatch` off it installs nothing, and `expectNotExecuted` refuses to pass.
  xss: [
    async ({ page, xssWatch }, use) => {
      const sentinel = new XssSentinel(page, xssWatch);
      if (xssWatch) await sentinel.install();
      await use(sentinel);
    },
    { auto: true },
  ],
  newVisitor: async ({ browser, baseURL, xss, xssWatch }, use) => {
    // Its users submit and read attack strings through real forms: our own shop only.
    if (!IS_SELF_HOSTED) throw new Error('newVisitor reaches real records: it only runs against the self-hosted Toolshop.');
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const visitor = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        contexts.push(visitor);
        // No console guard here, on purpose: the guard is built on the test's own `context` fixture and its allowances, annotations and
        // per-test verdict belong to that one context. These visitors only send or read a record and the specs that use them judge
        // the page through the sentinel (a payload that ran is a hit) and through `expectNoInjectedElements`, and the storefront pages
        // they open are guarded for console errors in every other spec.
        // Watched like the test's own, before their page is created.
        if (xssWatch) await xss.watch(visitor);
        return visitor.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
  visitorContactPage: async ({ newVisitor }, use) => {
    const contactPage = new ContactPage(await newVisitor());
    await contactPage.open();
    await use(contactPage);
  },
  visitorHomePage: async ({ newVisitor }, use) => {
    await use(new HomePage(await newVisitor()));
  },
});

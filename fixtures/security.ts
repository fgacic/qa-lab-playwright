import { mergeTests, type BrowserContext, type Page } from '@playwright/test';
import { ContactPage } from '@pages/ContactPage';
import { HomePage } from '@pages/HomePage';
import { IS_SELF_HOSTED } from '@support/env';
import type { World } from '@support/authz';
import { test as adminTokenTest } from './admin-token';
import { cleanupTest } from './cleanups';
import { XssSentinel } from './xss-sentinel';

// The payloads and the sentinel live in their own files; specs keep importing everything security from '@fixtures/security'.
export * from './xss-payloads';
export * from './xss-sentinel';

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
        // Only `baseURL` is carried over from the project's options, on purpose: a visitor is a bare second browser (no stored session,
        // locale or motion preference), so nothing from the test's own context leaks into what a stranger sees.
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

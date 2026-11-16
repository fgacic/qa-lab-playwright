import { expect, test } from '@fixtures';
import { consoleArgsText } from '@support/console-guard';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { ATTRIBUTE_XSS_PAYLOADS, MAX_SEARCH_TERM, ROUTE_XSS_PAYLOADS, XSS_PAYLOADS } from '@fixtures/security';
import { escapeRegExp } from '@support/regexp';

/**
 * Reflected input: what a visitor types is shown back without being stored anywhere, so these
 * run on both targets, the public site included (they only search and read). The chat tests send each payload to the chat's "find a
 * product" reply, which is a product search like the search box: one read per payload and run, nothing is written, and the bot
 * is a scripted menu (see ChatWidget), so no model or third party is asked.
 *
 * Checked, so not covered: the app reads no query string or fragment into a page. A probe marker sent as `?q=`, `?search=`,
 * `?query=`, `?page=`, `?by_category=`, `?returnUrl=`, `?subject=` and `#fragment` appears nowhere in the rendered text, so
 * the sinks below (the search box, the chat and the route segments) are the whole reflected surface. A new reader of the
 * address bar would need its own case here.
 */
test.describe('Injection, reflected (read-only)', { tag: ['@security'] }, () => {
  test.use({ xssWatch: true });

  // The attribute payloads too: a term is echoed into the caption and the count line, and a payload made for an attribute (a quote
  // that adds a handler, a `javascript:` URL) is the one a page would break by putting the term into a title, an `alt` or an `href`.
  // Those longer than the box acts on (BUG-27) would be dropped, so they are not searched. The box itself is no sink to check: the shop
  // empties it once the search is sent (its `value` is "" afterwards), so it holds nothing to reflect.
  const searched: [string, string][] = [
    ...Object.entries(XSS_PAYLOADS),
    ...Object.entries(ATTRIBUTE_XSS_PAYLOADS).flatMap(([name, { payload }]) => (payload.length <= MAX_SEARCH_TERM ? [[name, payload] as [string, string]] : [])),
  ];

  for (const [name, payload] of searched) {
    test(`a search for ${name} is shown as text, not run`, async ({ homePage, xss }) => {
      await homePage.search.searchFor(payload);

      await expect(homePage.search.caption).toHaveText(`Searched for: ${payload}`);
      // The count line echoes the term too, in a second place a sink could be.
      await expect(homePage.search.resultCount).toHaveText(new RegExp(`^\\s*\\d+ products? found for '${escapeRegExp(payload)}'\\s*$`));
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
    });

    test(`asking the chat for ${name} echoes it as text, not run`, async ({ homePage, xss }) => {
      const { chat } = homePage.shell;
      await chat.open();

      await chat.findProduct(payload);

      // The bot's answer is what the payload travels through; check only once it has arrived.
      await expect(chat.reply(/No products found|Here are some products I found/)).toBeVisible();
      await expect(chat.window.getByText(payload, { exact: true })).toBeVisible();
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
    });
  }
});

/** The same error, read from the error object itself (message text and the object's message), which every engine can give. */
const CATEGORY_TYPE_ERROR = /categories\[0\]|reading 'name'/;

/** The address bar is input too. Payloads go in as a path segment, percent-encoded as a browser would send them. */
test.describe('Injection, reflected through the route (read-only)', { tag: ['@security'] }, () => {
  test.use({ xssWatch: true });

  for (const [name, payload] of Object.entries(ROUTE_XSS_PAYLOADS)) {
    test(`a category named ${name} is shown as text, not run`, async ({ categoryPage, xss }) => {
      await categoryPage.open(encodeURIComponent(payload));

      // The page title echoes the slug, with each word capitalised (and the rest lower-cased), hence the case-insensitive match.
      await expect(categoryPage.title).toHaveText(new RegExp(`^Category: ${escapeRegExp(payload)}$`, 'i'));
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
    });

    // The product page asks for the id and, finding nothing, shows no part of it: nothing to read back, but still to survive.
    test(`a product id of ${name} is not run`, async ({ productPage, xss }) => {
      const slug = encodeURIComponent(payload);
      await productPage.open(slug);

      // Anchored on the page having rendered (its address is kept, and the related-products block, which needs no product, is drawn),
      // so "no text" below is read off a finished page and not a blank one.
      await expect(productPage.page).toHaveURL(new RegExp(`/product/${escapeRegExp(slug)}$`));
      await expect(productPage.relatedHeading).toBeVisible();
      await expect(productPage.page.getByText(payload)).toHaveCount(0);
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
    });
  }
});

/**
 * Found while guarding the console: the category page throws on a slug it does not know, a slug that comes straight from the
 * address bar. The page still draws (its title echoes the slug), so nothing visibly breaks, which is why only a console guard saw it.
 */
test.describe('Unknown route segments, uncaught errors (read-only)', { tag: ['@security', '@bug'] }, () => {
  test('an unknown category slug does not throw an uncaught error', async ({ categoryPage, page }) => {
    knownBug('SEC-13', 'the category page throws "TypeError: Cannot read properties of undefined (reading \'name\')" for a slug it does not know (any slug from the address bar).');
    const logged: Promise<string>[] = [];
    // The error object's own message, not the console text: Firefox prints an object it logged as `JSHandle@object`.
    page.on('console', (message) => {
      if (message.type() === 'error') logged.push(consoleArgsText(message.args()));
    });
    const thrownSoFar = async () => (await Promise.all(logged)).filter((text) => /TypeError/.test(text) && CATEGORY_TYPE_ERROR.test(text));

    await categoryPage.open('qa-lab-no-such-category');
    // Precondition, true whether or not the bug is fixed: the page drew for the slug (its answer was waited for in `open`).
    await expect(categoryPage.title).toBeVisible();
    // The error is logged a moment after the page draws, so a read right now could miss it and pass a broken page. Give it the pin's
    // window to arrive (settled, not awaited for success: on a fixed site none does, and the window runs out into the assertion below).
    await Promise.allSettled([expect.poll(thrownSoFar, { timeout: BUG_TIMEOUT }).not.toEqual([])]);

    expect(await thrownSoFar(), 'SEC-13: the category page threw for an unknown slug').toEqual([]);
  });
});

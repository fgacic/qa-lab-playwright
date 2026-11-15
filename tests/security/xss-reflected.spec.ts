import { expect, test } from '@fixtures';
import { ROUTE_XSS_PAYLOADS, XSS_PAYLOADS } from '@fixtures/security';

/**
 * Reflected input: what a visitor types is shown back without being stored anywhere, so these
 * run on both targets, the public site included (they only search and read).
 */
test.describe('Injection, reflected (read-only)', { tag: ['@security'] }, () => {
  test.use({ xssWatch: true });

  for (const [name, payload] of Object.entries(XSS_PAYLOADS)) {
    test(`a search for ${name} is shown as text, not run`, async ({ homePage, xss }) => {
      await homePage.search.searchFor(payload);

      await expect(homePage.search.caption).toHaveText(`Searched for: ${payload}`);
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

/** The address bar is input too. Payloads go in as a path segment, percent-encoded as a browser would send them. */
test.describe('Injection, reflected through the route (read-only)', { tag: ['@security'] }, () => {
  test.use({ xssWatch: true });

  const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
      await productPage.open(encodeURIComponent(payload));

      await expect(productPage.page.getByText(payload)).toHaveCount(0);
      await xss.expectNoInjectedElements();
      await xss.expectNotExecuted();
    });
  }
});

import { expect, test } from '@fixtures';
import { XSS_PAYLOADS } from '@fixtures/security';

/**
 * Reflected input: what a visitor types is shown back without being stored anywhere, so these
 * run on both targets, the public site included (they only search).
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

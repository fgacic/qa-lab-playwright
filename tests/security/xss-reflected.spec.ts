import { expect, test } from '@fixtures';
import { XSS_PAYLOADS } from '../../fixtures/security';

/**
 * Reflected input: what a visitor types is shown back without being stored anywhere, so these
 * run on both targets, the public site included (they only search).
 */
test.describe('Injection, reflected (read-only)', { tag: ['@security'] }, () => {
  for (const [name, payload] of Object.entries(XSS_PAYLOADS)) {
    test(`a search for ${name} is shown as text, not run`, async ({ homePage, xss }) => {
      await homePage.search.searchFor(payload);

      await expect(homePage.search.caption).toHaveText(`Searched for: ${payload}`);
      await expect(xss.injectedElements()).toHaveCount(0);
      expect(await xss.executed(), 'the payload executed').toBe(false);
    });

    test(`asking the chat for ${name} echoes it as text, not run`, async ({ homePage, xss }) => {
      const { chat } = homePage.shell;
      await chat.open();

      await chat.findProduct(payload);

      await expect(chat.window.getByText(payload, { exact: true })).toBeVisible();
      await expect(xss.injectedElements()).toHaveCount(0);
      expect(await xss.executed(), 'the payload executed').toBe(false);
    });
  }
});

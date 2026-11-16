import { expect, test } from '@fixtures';
import { failAsset } from '@support/asset-mock';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** The file the shop loads when a language is chosen (`assets/i18n/<language>.json`). */
const GERMAN_FILE = /\/assets\/i18n\/de\.json$/;

test.describe('Language switcher: when a translation file cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
  test('the shopper is told the language could not be loaded', async ({ homePage, page, consoleGuard }) => {
    knownBug('BUG-63', 'a translation file that fails to load (500) leaves the page in English with no message, while the switcher and the page language already say German.', { absence: true });
    // Only the 500 this test answers (the browser's line names the status, not the file): any other failed request still fails the test.
    consoleGuard.allow(/^Failed to load resource: the server responded with a status of 500\b/, 'the test answers the German translation file with the 500 the pin is about: the browser logs it');
    await failAsset(page, GERMAN_FILE);
    const asked = page.waitForResponse(GERMAN_FILE);

    await homePage.header.language.switchTo('de');

    // Holds whether or not the shop reports it: the file was asked for and refused, and the shop is still there to use.
    expect((await asked).status(), 'the German file is answered with the mocked failure').toBe(500);
    await expect(homePage.grid.cards.first()).toBeVisible();
    await expect(failureFeedback(page).first(), 'BUG-63: a translation file that fails to load is reported').toBeVisible({ timeout: BUG_TIMEOUT });
  });
});

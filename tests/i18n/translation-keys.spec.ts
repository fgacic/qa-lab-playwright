import { expect, test } from '@playwright/test';
import { untranslatedKeys, visibleUiText } from '@support/i18n';

/**
 * The leaked-key detector, on text the shop really renders: a key is flagged wherever it is
 * shown, and an email, a URL, a price, a version or an abbreviation is not mistaken for one.
 * Mostly no page is opened (so `test` comes from Playwright itself, not the suite's page fixtures): this guards the guard.
 * The one exception reads a page the test builds from a string, to guard how a read labels the text it finds.
 * @i18n: Chromium only, with the rest of the translation checks.
 */
test.describe('Leaked translation keys are recognised', { tag: ['@i18n'] }, () => {
  test('single-dot and deeper keys are flagged, alone or in a sentence', () => {
    expect(untranslatedKeys(['nav.home', 'page.forgot-password.confirm', 'Error: pagination.next failed', 'Sign in (login.title)'])).toEqual([
      'nav.home',
      'page.forgot-password.confirm',
      'pagination.next',
      'login.title',
    ]);
  });

  test('keys with digits, camelCase or a capital are flagged too', () => {
    expect(untranslatedKeys(['errors.404.title', 'page.forgotPassword', 'nav.Home', 'Oops: errors.404.title.', 'cart.items.2'])).toEqual([
      'errors.404.title',
      'page.forgotPassword',
      'nav.Home',
      'errors.404.title',
      'cart.items.2',
    ]);
  });

  // The edges of the pattern, each of which a narrower detector missed: a camelCase or upper-case first
  // segment, a key glued to punctuation, a key that starts with a digit, and a key that is all there is.
  test('keys at the limits of the pattern are flagged', () => {
    expect(untranslatedKeys(['navBar.home', 'NAV.HOME', 'Error:nav.home', '(nav.home)', '"nav.home"', 'nav.home,', '2fa.title'])).toEqual([
      'navBar.home',
      'NAV.HOME',
      'nav.home',
      'nav.home',
      'nav.home',
      'nav.home',
      '2fa.title',
    ]);
    expect(untranslatedKeys(['nav.home'])).toEqual(['nav.home']);
  });

  test('a key and a real address in one text are told apart', () => {
    expect(untranslatedKeys(['Write to info@testsmith.io or see nav.home', 'Visit www.practicesoftwaretesting.com, then login.title'])).toEqual(['nav.home', 'login.title']);
  });

  // Two shapes the detector is built not to flag, pinned so a change to it is a decision and not an accident: a key whose
  // only other segment is a number ("errors.404") looks like a decimal, a version or an order number ("12.345", "2.5kg",
  // "v5.3.1"), and a key of two short segments ("ui.ok") looks like an abbreviation ("e.g", "i.e", "d.h", "π.χ").
  // Both limits end at a longer name, which is flagged.
  test('documented limits: a number segment and two short segments are not flagged', () => {
    expect(untranslatedKeys(['errors.404', 'ui.ok'])).toEqual([]);
    expect(untranslatedKeys(['errors.notFound', 'ui.okay', 'errors.404.title'])).toEqual(['errors.notFound', 'ui.okay', 'errors.404.title']);
  });

  test('real page text holds no key', () => {
    const real = [
      'Have at least one special symbol (e.g., @, #, $, etc.)',
      'Please enter a valid date in YYYY-MM-DD format.',
      'Contact us at info [at] testsmith [dot] io.',
      'Email: testy.mctestface@example.com',
      'Visit https://www.practicesoftwaretesting.com/privacy or api.practicesoftwaretesting.com',
      'Total $1,234.56 (incl. 21.0% VAT), 0.5 kg',
      'Toolshop v5.3.1, build 2026.11.04',
      'Attachment: only .txt files (max. 250 KB), e.g. notes.txt',
      'Effective Date: Nov. 4, 2026. Thank you.',
      'Greek (π.χ. αυτό) and German (d.h. dies, z. B. das)',
      // The footer's build line, a version, a decimal, an ordinal date and a sentence run into the next without a space.
      'vdev | Built 2026-07-07 | Angular 20.0.5',
      'Running v5.3.1 on port 4200',
      'Order no. 12.345, weight 2.5kg, Error 404.',
      'Open Mon.-Fri. 9.00-17.00 or call 0800.123.456',
    ];

    expect(untranslatedKeys(real)).toEqual([]);
  });

  // Documented gap: with no dot, a key cannot be told from a word ("home", "login_title"). It is not flagged here; a leaked
  // single-segment key is found by the stray-English comparison (it equals English), which is why that check exists beside this one.
  test('documented gap: a key of one segment is not flagged', () => {
    expect(untranslatedKeys(['home', 'HOME', 'nav-home', 'login_title', 'nav_home'])).toEqual([]);
    // The same word glued to a second segment is a key again: the gap is exactly "no dot".
    expect(untranslatedKeys(['home.title', 'login_title.text'])).toEqual(['home.title', 'login_title.text']);
  });
});

test.describe('The UI text read from a page', { tag: ['@i18n'] }, () => {
  test('a string in the header and in the page is the page\'s', async ({ page }) => {
    // The header's copy comes first in the document: the label of the string must not stay "shell" because that is the one read first.
    await page.setContent(`
      <title>Shared</title>
      <app-header><a href="#">Contact</a><span>Only in the header</span></app-header>
      <main><h1>Contact</h1><p>Only in the page</p></main>
      <app-footer><span>Only in the footer</span></app-footer>`);

    const read = await visibleUiText(page);
    const partOf = (text: string) => read.find((t) => t.kind === 'text' && t.text === text)?.part;

    expect(partOf('Contact')).toBe('page');
    expect(partOf('Only in the header')).toBe('shell');
    expect(partOf('Only in the page')).toBe('page');
    expect(partOf('Only in the footer')).toBe('shell');
  });

  test('a card with a picture holds data the key scan skips, a card without one is the shop\'s own words', async ({ page }) => {
    await page.setContent(`
      <main>
        <div class="card"><img src="data:," alt="Claw hammer"><h5 class="card-title">Claw Hammer</h5><p class="card-text">A hammer for nails</p></div>
        <div class="card"><h5 class="card-title">account.favorites.title</h5><p class="card-text">account.favorites.text</p></div>
        <figure><img src="data:," alt="Tool"><figcaption>photo.credit</figcaption></figure>
      </main>`);

    const keys = (await visibleUiText(page, 'keys')).map((t) => t.text);
    const strays = (await visibleUiText(page, 'strays')).map((t) => t.text);

    expect(keys, 'the key scan reads the tile and the credit, not the product card').toEqual(expect.arrayContaining(['account.favorites.title', 'account.favorites.text', 'photo.credit']));
    expect(keys).not.toContain('Claw Hammer');
    expect(keys).not.toContain('A hammer for nails');
    expect(strays, 'the stray-English scan keeps skipping every card title and text, and the credit').toEqual([]);
  });
});

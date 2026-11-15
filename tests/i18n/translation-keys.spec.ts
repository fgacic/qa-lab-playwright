import { expect, test } from '@playwright/test';
import { untranslatedKeys } from '@support/i18n';

/**
 * The leaked-key detector, on text the shop really renders: a key is flagged wherever it is
 * shown, and an email, a URL, a price, a version or an abbreviation is not mistaken for one.
 * No page is opened (so `test` comes from Playwright itself, not the suite's page fixtures): this guards the guard.
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
});

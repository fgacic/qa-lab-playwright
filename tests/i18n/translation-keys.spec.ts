import { expect, test } from '@fixtures';
import { untranslatedKeys } from '@support/i18n';

/**
 * The leaked-key detector, on text the shop really renders: a key is flagged wherever it is
 * shown, and an email, a URL, a price, a version or an abbreviation is not mistaken for one.
 * No page is opened: this guards the guard.
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
    ];

    expect(untranslatedKeys(real)).toEqual([]);
  });
});

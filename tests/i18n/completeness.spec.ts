import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, test } from '@fixtures';
import type { Page } from '@playwright/test';
import { skipIfBotChallenge } from '@support/bot-challenge';
import { knownBug } from '@support/known-bug';
import { SAME_AS_ENGLISH, SAME_IN_EVERY_LANGUAGE, untranslatedKeys, visibleUiText } from '@support/i18n';
import type { Catalog } from '../../fixtures/api';

/**
 * Every public page and key state in all seven languages. A page fails on a leaked translation
 * key ("page.x.y") or on English text that should have been translated: text identical to the
 * English rendering of the same page, minus the shop's data and legitimate shared words.
 * Untranslated text known today is listed in KNOWN and pinned once per defect below.
 * @i18n: Chromium only (playwright.config.ts); translation files do not depend on the engine.
 */
const KNOWN: { id: string; text: RegExp; summary: string }[] = [
  { id: 'I18N-01', text: /^(View the|Documentation|for this application\.)$/, summary: 'the notification bar ("View the Documentation for this application.") is English in every language' },
  { id: 'I18N-02', text: /^Practice Software Testing - Toolshop$/, summary: 'the page heading (visually hidden, read by screen readers) is English in every language' },
  { id: 'I18N-03', text: /^(Privacy Policy|\| Banner photo by|on)$/, summary: 'the footer ("Privacy Policy", "Banner photo by … on Unsplash") is English in every language' },
  { id: 'I18N-04', text: /^Sign in with Google$/, summary: '"Sign in with Google" is English in every language' },
  { id: 'I18N-05', text: /^(Please enter a valid date in YYYY-MM-DD format\.|Your password must:|Be at least 8 characters long|Contain both uppercase and lowercase letters|Include at least one number|Have at least one special symbol \(e\.g\., @, #, \$, etc\.\)|Password strength:|Weak|Moderate|Strong|Very Strong|Excellent)$/, summary: 'registration: the date-format error, the password rules and the strength meter are English in every language' },
  { id: 'I18N-07', text: /^Quantity$/, summary: 'the product page\'s "Quantity" label is hard-coded English' },
  { id: 'I18N-06', text: /^(Privacy Policy for Toolshop|Effective Date:.*|Thank you for using Toolshop.*|Information We Collect:)$/, summary: 'the privacy policy page is English in every language' },
];

interface Visit {
  path: string | ((catalog: Catalog) => Promise<string>);
  name: string;
  /** Test id of the submit button to press, to show the form's validation errors. */
  submit?: string;
}

const VISITS: Visit[] = [
  { path: '/', name: 'home' },
  { path: async (catalog) => `/product/${(await catalog.inStock()).id}`, name: 'product page' },
  { path: '/category/hand-tools', name: 'category page' },
  { path: '/rentals', name: 'rentals' },
  { path: '/comparison', name: 'empty comparison' },
  { path: '/checkout', name: 'cart' },
  // Submit buttons by test id: their names change with the language.
  { path: '/contact', name: 'contact with errors', submit: 'contact-submit' },
  { path: '/auth/login', name: 'login with errors', submit: 'login-submit' },
  { path: '/auth/register', name: 'registration with errors', submit: 'register-submit' },
  { path: '/auth/forgot-password', name: 'forgot password' },
];

/** Opens the page as a returning visitor who chose `language`, and returns its UI text. */
async function textIn(page: Page, language: Language, path: string, visit: Visit): Promise<string[]> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.evaluate((lang) => localStorage.setItem('language', lang), language);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await skipIfBotChallenge(page);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.getByRole('contentinfo')).toBeVisible();
  if (visit.submit) await page.getByTestId(visit.submit).click();
  await expect.poll(async () => (await visibleUiText(page)).length, { message: 'the page rendered its text' }).toBeGreaterThan(5);
  return visibleUiText(page);
}

test.describe('Translations are complete', { tag: ['@i18n'] }, () => {
  for (const visit of VISITS) {
    test(`${visit.name}: no leaked keys and no stray English in any language`, async ({ page, catalog }) => {
      const path = typeof visit.path === 'string' ? visit.path : await visit.path(catalog);
      const english = new Set(await textIn(page, 'en', path, visit));
      const problems: string[] = [];

      for (const language of LANGUAGES) {
        const texts = await textIn(page, language, path, visit);
        for (const key of untranslatedKeys(texts)) problems.push(`${language}: translation key "${key}"`);
        if (language === 'en') continue;
        const stray = texts.filter((t) => english.has(t) && !SAME_IN_EVERY_LANGUAGE.includes(t) && !SAME_AS_ENGLISH[language]?.includes(t) && !KNOWN.some((k) => k.text.test(t)));
        for (const text of stray) problems.push(`${language}: English "${text}"`);
      }

      expect(problems).toEqual([]);
    });
  }
});

test.describe('Known untranslated text', { tag: ['@i18n', '@bug'] }, () => {
  const pins: { id: string; visit: Visit }[] = [
    { id: 'I18N-01', visit: VISITS[0] },
    { id: 'I18N-02', visit: VISITS[0] },
    { id: 'I18N-03', visit: VISITS[0] },
    { id: 'I18N-04', visit: VISITS.find((v) => v.name === 'login with errors')! },
    { id: 'I18N-05', visit: VISITS.find((v) => v.name === 'registration with errors')! },
    { id: 'I18N-06', visit: { path: '/privacy', name: 'privacy policy' } },
    { id: 'I18N-07', visit: { path: '/product/', name: 'product page' } },
  ];

  for (const { id, visit } of pins) {
    const known = KNOWN.find((k) => k.id === id)!;
    test(`${id}: ${known.summary.split(':')[0].split(' (')[0]} is translated`, async ({ page, catalog }) => {
      knownBug(id, known.summary);
      // The product pin opens a product found at runtime; the others have fixed paths.
      const path = visit.path === '/product/' ? `/product/${(await catalog.inStock()).id}` : (visit.path as string);
      const english = (await textIn(page, 'en', path, visit)).filter((t) => known.text.test(t));
      expect(english.length, 'the English text exists to compare against').toBeGreaterThan(0);

      const stillEnglish = (await textIn(page, 'de', path, visit)).filter((t) => english.includes(t));

      expect(stillEnglish, 'in German').toEqual([]);
    });
  }
});

import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { skipIfBotChallenge } from '@support/bot-challenge';
import {
  SAME_AS_ENGLISH,
  SAME_IN_EVERY_LANGUAGE,
  describeUiText,
  startInLanguage,
  untranslatedKeys,
  visibleUiText,
  type UiText,
  type UiTextKind,
} from '@support/i18n';
import { knownBug } from '@support/known-bug';
import type { Catalog } from '@fixtures/api';

/**
 * Every public page and key state in all seven languages. A page fails on a leaked translation
 * key ("nav.home") or on English text that should have been translated: text, attributes
 * (placeholder, aria-label, title, alt, button values) and options identical to the English
 * rendering of the same page, minus the shop's data and legitimate shared words (support/i18n.ts).
 * One test per page, language and check, so the report names each defect on its own row.
 * Untranslated text known today is listed in KNOWN and pinned once per defect below.
 * @i18n: Chromium only (playwright.config.ts); translation files do not depend on the engine.
 */
interface KnownUntranslated {
  id: string;
  /** What is untranslated, as the pin's title reads: "<title> is translated". */
  title: string;
  /** The visit the pin opens, and the only one the defect is looked for on, unless `everywhere`. */
  visit: string;
  /** Part of the header, footer or widgets: on every page. */
  everywhere?: boolean;
  /** Which kind of UI text it is: the text itself unless stated. */
  kinds?: UiTextKind[];
  text: RegExp;
  summary: string;
}

const KNOWN: KnownUntranslated[] = [
  { id: 'I18N-01', title: 'the notification bar', visit: 'home', everywhere: true, text: /^(View the|Documentation|for this application\.)$/, summary: 'the notification bar ("View the Documentation for this application.") is English in every language' },
  { id: 'I18N-02', title: 'the page heading', visit: 'home', everywhere: true, text: /^Practice Software Testing - Toolshop$/, summary: 'the page heading (visually hidden, read by screen readers) is English in every language' },
  { id: 'I18N-03', title: 'the footer', visit: 'home', everywhere: true, text: /^(Privacy Policy|\| Banner photo by|on)$/, summary: 'the footer ("Privacy Policy", "Banner photo by … on Unsplash") is English in every language' },
  { id: 'I18N-04', title: '"Sign in with Google"', visit: 'login with errors', kinds: ['text', 'aria-label'], text: /^Sign in with Google$/, summary: '"Sign in with Google" is English in every language' },
  { id: 'I18N-05', title: 'the registration form\'s hints', visit: 'registration with errors', text: /^(Please enter a valid date in YYYY-MM-DD format\.|Your password must:|Be at least 8 characters long|Contain both uppercase and lowercase letters|Include at least one number|Have at least one special symbol \(e\.g\., @, #, \$, etc\.\)|Password strength:|Weak|Moderate|Strong|Very Strong|Excellent)$/, summary: 'registration: the date-format error, the password rules and the strength meter are English in every language' },
  { id: 'I18N-06', title: 'the privacy policy', visit: 'privacy policy', text: /./, summary: 'the privacy policy page, headings and paragraphs, is English in every language' },
  { id: 'I18N-07', title: 'the product page\'s "Quantity" label', visit: 'product page', text: /^Quantity$/, summary: 'the product page\'s "Quantity" label is hard-coded English' },
  // Found by reading attributes and options too (they were never scanned before).
  { id: 'I18N-08', title: 'the logo\'s tooltip', visit: 'home', everywhere: true, kinds: ['title'], text: /^Practice Software Testing - Toolshop$/, summary: 'the logo\'s tooltip ("Practice Software Testing - Toolshop") is English in German and French' },
  { id: 'I18N-09', title: 'the header navigation\'s labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Main menu|nav-categories|Select language)$/, summary: 'the aria-labels of the main menu, the categories menu ("nav-categories", an internal id) and the language button are English in every language' },
  { id: 'I18N-10', title: 'the floating buttons\' labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Open chat|Show live shop activity)$/, summary: 'the aria-labels of the chat and live-activity buttons are English in every language' },
  { id: 'I18N-11', title: 'the sort and price-range labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(sort|Sort products|ngx-slider|ngx-slider-max)$/, summary: 'the aria-labels of the sort list ("sort", "Sort products") and the price sliders ("ngx-slider", "ngx-slider-max", library ids) are English in every language' },
  { id: 'I18N-12', title: 'the pagination labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Previous|Next|Page-\d+)$/, summary: 'the aria-labels of the pagination buttons ("Previous", "Next", "Page-1") are English in every language' },
  { id: 'I18N-13', title: 'the login page\'s labels', visit: 'login with errors', kinds: ['aria-label'], text: /^(Alternative login methods|Login|Forgot your Password\?|Register your account)$/, summary: 'the aria-labels on the login page (the methods group, the Login button, the forgot-password and register links) are English in every language' },
  { id: 'I18N-14', title: 'the product page\'s category and brand labels', visit: 'product page', kinds: ['aria-label'], text: /^(category|brand)$/, summary: 'the aria-labels "category" and "brand" on the product page are English ids in every language' },
  { id: 'I18N-15', title: 'the banner image\'s alt text', visit: 'home', kinds: ['alt'], text: /^Banner$/, summary: 'the home page banner image\'s alt text ("Banner") is English in every language' },
];

interface Visit {
  name: string;
  path: string | ((catalog: Catalog) => Promise<string>);
  /**
   * What shows that the page rendered its own content, not just the header and footer. By test
   * id or role, because names change with the language.
   */
  ready: (page: Page) => Locator[];
  /** Test ids of the submit button to press and of the first validation error it must show. */
  submit?: { button: string; error: string };
}

const VISITS: Visit[] = [
  {
    name: 'home',
    path: '/',
    ready: (page) => [page.getByTestId('product-name'), page.getByTestId(/^category-/), page.getByTestId(/^brand-/), page.getByTestId('pagination-next')],
  },
  {
    name: 'product page',
    path: async (catalog) => `/product/${(await catalog.inStock()).id}`,
    ready: (page) => [page.getByTestId('add-to-cart'), page.getByTestId('product-specs'), page.getByRole('heading', { level: 5 })],
  },
  { name: 'category page', path: '/category/hand-tools', ready: (page) => [page.getByTestId('page-title'), page.getByTestId('product-name')] },
  { name: 'rentals', path: '/rentals', ready: (page) => [page.getByTestId('page-title'), page.getByTestId(/^product-[0-9A-Z]{26}$/)] },
  { name: 'empty comparison', path: '/comparison', ready: (page) => [page.getByTestId('comparison-empty')] },
  // An empty cart renders only the four numbered steps of the wizard; the last is its marker.
  { name: 'cart', path: '/checkout', ready: (page) => [page.getByText('4', { exact: true })] },
  { name: 'contact with errors', path: '/contact', ready: (page) => [page.getByTestId('contact-submit')], submit: { button: 'contact-submit', error: 'first-name-error' } },
  { name: 'login with errors', path: '/auth/login', ready: (page) => [page.getByTestId('login-submit')], submit: { button: 'login-submit', error: 'email-error' } },
  { name: 'registration with errors', path: '/auth/register', ready: (page) => [page.getByTestId('register-submit')], submit: { button: 'register-submit', error: 'first-name-error' } },
  { name: 'forgot password', path: '/auth/forgot-password', ready: (page) => [page.getByTestId('forgot-password-submit')] },
  { name: 'privacy policy', path: '/privacy', ready: (page) => [page.getByRole('heading', { level: 1 })] },
];

const visitNamed = (name: string): Visit => {
  const visit = VISITS.find((v) => v.name === name);
  if (!visit) throw new Error(`No visit named "${name}"`);
  return visit;
};

const pathOf = (visit: Visit, catalog: Catalog): Promise<string> | string => (typeof visit.path === 'string' ? visit.path : visit.path(catalog));

/** The UI text of the page as a returning visitor who chose `language` sees it, once its own content is there. */
async function textIn(page: Page, language: Language, visit: Visit, path: string): Promise<UiText[]> {
  await startInLanguage(page, language);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await skipIfBotChallenge(page);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  for (const content of visit.ready(page)) await expect(content.first()).toBeVisible();
  if (visit.submit) {
    await page.getByTestId(visit.submit.button).click();
    await expect(page.getByTestId(visit.submit.error).first()).toBeVisible();
  }
  return visibleUiText(page);
}

const sameKey = (t: UiText) => `${t.kind}\u0000${t.text}`;
const isKnown = (t: UiText, visit: Visit) => KNOWN.some((k) => (k.everywhere || k.visit === visit.name) && (k.kinds ?? ['text']).includes(t.kind) && k.text.test(t.text));
const isShared = (t: UiText, language: Language) => SAME_IN_EVERY_LANGUAGE.includes(t.text) || !!SAME_AS_ENGLISH[language]?.includes(t.text);

test.describe('Translations are complete', { tag: ['@i18n'] }, () => {
  for (const visit of VISITS) {
    for (const language of LANGUAGES) {
      test(`${visit.name} in ${language}: no translation key leaks`, async ({ page, catalog }) => {
        const texts = await textIn(page, language, visit, await pathOf(visit, catalog));

        expect(untranslatedKeys(texts.map((t) => t.text)), `translation keys shown on ${visit.name} in ${language}`).toEqual([]);
      });

      if (language === 'en') continue;
      test(`${visit.name} in ${language}: no stray English`, async ({ page, catalog }) => {
        const path = await pathOf(visit, catalog);
        // The English rendering of the same page, in a second tab of the same session.
        const english = new Set((await textIn(await page.context().newPage(), 'en', visit, path)).map(sameKey));
        const texts = await textIn(page, language, visit, path);

        const stray = texts.filter((t) => english.has(sameKey(t)) && !isShared(t, language) && !isKnown(t, visit)).map(describeUiText);

        expect(stray, `English text left on ${visit.name} in ${language}`).toEqual([]);
      });
    }
  }
});

test.describe('Known untranslated text', { tag: ['@i18n', '@bug'] }, () => {
  for (const known of KNOWN) {
    test(`${known.id}: ${known.title} is translated`, async ({ page, catalog }) => {
      knownBug(known.id, known.summary);
      const visit = visitNamed(known.visit);
      const path = await pathOf(visit, catalog);
      const english = new Set((await textIn(await page.context().newPage(), 'en', visit, path)).map(sameKey));

      // Identical to the English rendering: a fixed site shows nothing here, and so does a renamed string.
      const stillEnglish = (await textIn(page, 'de', visit, path))
        .filter((t) => english.has(sameKey(t)) && (known.kinds ?? ['text']).includes(t.kind) && known.text.test(t.text))
        .map(describeUiText);

      expect(stillEnglish, `${known.id}: ${known.title} is still English in German`).toEqual([]);
    });
  }
});

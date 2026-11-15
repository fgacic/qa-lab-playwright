import { CheckoutWizard } from '@components/checkout/CheckoutWizard';
import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, test } from '@fixtures';
import type { Locator, Page } from '@playwright/test';
import { skipIfBotChallenge } from '@support/bot-challenge';
import {
  SAME_AS_ENGLISH,
  SAME_IN_EVERY_LANGUAGE,
  describeUiText,
  settledUiText,
  startInLanguage,
  untranslatedKeys,
  type UiText,
  type UiTextKind,
} from '@support/i18n';
import { knownBug } from '@support/known-bug';
import type { ApiFixtures, Catalog } from '@fixtures/api';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * Every public page and key state in all seven languages. A page fails on a leaked translation
 * key ("nav.home") or on English text that should have been translated: text, attributes
 * (placeholder, aria-label, title, alt, button values), the document title and options identical
 * to the English rendering of the same page, minus the shop's data and legitimate shared words (support/i18n.ts).
 * One test per page, language and check, so the report names each defect on its own row.
 * Untranslated text known today is listed in KNOWN and pinned once per defect below.
 * @i18n: Chromium only (playwright.config.ts); translation files do not depend on the engine.
 */
interface KnownUntranslated {
  id: string;
  /** What is untranslated, as the pin's title reads: "<title> is translated". */
  title: string;
  /** The visit the pin opens, and the only one the defect is looked for on, unless `also` or `everywhere`. */
  visit: string;
  /** Other visits that show the same element, so it is not reported again there. */
  also?: string[];
  /** Part of the header, footer or widgets: on every page. */
  everywhere?: boolean;
  /** Only in these languages; the rest translate it. Every language when left out. */
  languages?: Language[];
  /** Only the route's own content, not the header and footer around it. */
  pageOnly?: boolean;
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
  { id: 'I18N-06', title: 'the privacy policy', visit: 'privacy policy', pageOnly: true, text: /./, summary: 'the privacy policy page, headings and paragraphs, is English in every language' },
  { id: 'I18N-07', title: 'the product page\'s "Quantity" label', visit: 'product page', also: ['product page with a toast'], text: /^Quantity$/, summary: 'the product page\'s "Quantity" label is hard-coded English' },
  // Found by reading attributes and options too (they were never scanned before).
  { id: 'I18N-08', title: 'the logo\'s tooltip', visit: 'home', everywhere: true, languages: ['de', 'fr'], kinds: ['title'], text: /^Practice Software Testing - Toolshop$/, summary: 'the logo\'s tooltip ("Practice Software Testing - Toolshop") is English in German and French' },
  { id: 'I18N-09', title: 'the header navigation\'s labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Main menu|nav-categories|Select language)$/, summary: 'the aria-labels of the main menu, the categories menu ("nav-categories", an internal id) and the language button are English in every language' },
  { id: 'I18N-10', title: 'the floating buttons\' labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Open chat|Show live shop activity)$/, summary: 'the aria-labels of the chat and live-activity buttons are English in every language' },
  { id: 'I18N-11', title: 'the sort and price-range labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(sort|Sort products|ngx-slider|ngx-slider-max)$/, summary: 'the aria-labels of the sort list ("sort", "Sort products") and the price sliders ("ngx-slider", "ngx-slider-max", library ids) are English in every language' },
  { id: 'I18N-12', title: 'the pagination labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Previous|Next|Page-\d+)$/, summary: 'the aria-labels of the pagination buttons ("Previous", "Next", "Page-1") are English in every language' },
  { id: 'I18N-13', title: 'the login page\'s labels', visit: 'login with errors', kinds: ['aria-label'], text: /^(Alternative login methods|Login|Forgot your Password\?|Register your account)$/, summary: 'the aria-labels on the login page (the methods group, the Login button, the forgot-password and register links) are English in every language' },
  { id: 'I18N-14', title: 'the product page\'s category and brand labels', visit: 'product page', also: ['product page with a toast'], kinds: ['aria-label'], text: /^(category|brand)$/, summary: 'the aria-labels "category" and "brand" on the product page are English ids in every language' },
  { id: 'I18N-15', title: 'the banner image\'s alt text', visit: 'home', also: ['chat open', 'language menu open'], kinds: ['alt'], text: /^Banner$/, summary: 'the home page banner image\'s alt text ("Banner") is English in every language' },
  // Found by reading the document title, the cart lines, the payment form and the chat window.
  { id: 'I18N-16', title: 'the page titles', visit: 'privacy policy', everywhere: true, kinds: ['page-title'], text: /^(Checkout|Login|Register|Forgot Password|Contact Us|Privacy Policy|Product Comparison|Rentals Overview) - Practice Software Testing - Toolshop - v[\d.]+$/, summary: 'the browser tab title of the checkout, login, register, forgot-password, contact, privacy, comparison and rentals pages is English in every language' },
  { id: 'I18N-17', title: 'the cart link\'s label', visit: 'cart with a product', everywhere: true, kinds: ['aria-label'], text: /^cart$/, summary: 'the aria-label of the header cart link ("cart", an internal id) is English in every language' },
  { id: 'I18N-18', title: 'the cart lines\' quantity labels', visit: 'cart with a product', text: /^Quantity for /, summary: 'the cart\'s per-line quantity label ("Quantity for <product>") is English in every language' },
  { id: 'I18N-19', title: 'the card form', visit: 'checkout payment', languages: ['de'], kinds: ['text', 'placeholder'], text: /^(Credit Card Number|Enter your 16-digit credit card number.*|Expiration Date|The CVV is a 3-digit or 4-digit number.*|Card Holder Name)$/, summary: 'the credit-card form\'s labels, hints and placeholders are English in German' },
  { id: 'I18N-20', title: 'the chat window\'s close button', visit: 'chat open', kinds: ['aria-label'], text: /^Close chat$/, summary: 'the aria-label of the chat window\'s close button ("Close chat") is English in every language' },
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
  /** The page needs a cart with a product in it: made through the API before the page opens. */
  cart?: boolean;
  /** The document title is the name of a product or category from the shop's data, not text to translate. */
  dataTitle?: boolean;
  /** Steps that bring the opened page to the state to read, by test id so they work in any language. */
  drive?: (page: Page) => Promise<void>;
  /**
   * The steps `drive` takes find things by their English names. They run in English, and the
   * language menu then switches the page, as a visitor who changes language half way would.
   */
  driveInEnglish?: boolean;
}

/** The header's "Sign in" link in each language: proof that the translation file is in, whatever else is on the page. */
const SIGN_IN: Record<Language, string> = { de: 'Einloggen', el: 'Σύνδεση', en: 'Sign in', es: 'Iniciar sesión', fr: 'Se connecter', nl: 'Inloggen', tr: 'Giriş Yap' };

const VISITS: Visit[] = [
  {
    name: 'home',
    path: '/',
    ready: (page) => [page.getByTestId('product-name'), page.getByTestId(/^category-/), page.getByTestId(/^brand-/), page.getByTestId('pagination-next')],
  },
  {
    name: 'product page',
    dataTitle: true,
    path: async (catalog) => `/product/${(await catalog.inStock()).id}`,
    ready: (page) => [page.getByTestId('add-to-cart'), page.getByTestId('product-specs'), page.getByRole('heading', { level: 5 })],
  },
  {
    name: 'product page with a toast',
    dataTitle: true,
    path: async (catalog) => `/product/${(await catalog.inStock()).id}`,
    ready: (page) => [page.getByTestId('add-to-cart')],
    drive: async (page) => {
      await page.getByTestId('add-to-cart').click();
      await expect(page.getByRole('alert').first()).toBeVisible();
    },
  },
  {
    name: 'product not found',
    // There is no 404 page: an unknown route redirects home (BUG-02). An unknown product id is the nearest error state.
    path: '/product/00000000000000000000000000',
    // All the page draws is the "Related products" heading.
    ready: (page) => [page.getByRole('heading', { level: 2 })],
  },
  { name: 'category page', dataTitle: true, path: '/category/hand-tools', ready: (page) => [page.getByTestId('page-title'), page.getByTestId('product-name')] },
  { name: 'rentals', path: '/rentals', ready: (page) => [page.getByTestId('page-title'), page.getByTestId(/^product-[0-9A-Z]{26}$/)] },
  { name: 'empty comparison', path: '/comparison', ready: (page) => [page.getByTestId('comparison-empty')] },
  // An empty cart renders only the four numbered steps of the wizard; the last is its marker.
  { name: 'empty cart', path: '/checkout', ready: (page) => [page.getByText('4', { exact: true })] },
  { name: 'cart with a product', path: '/checkout', cart: true, ready: (page) => [page.getByTestId('proceed-1')] },
  {
    name: 'checkout billing',
    path: '/checkout',
    cart: true,
    ready: (page) => [page.getByTestId('proceed-1')],
    driveInEnglish: true,
    drive: async (page) => {
      const { cart, signIn, billing } = new CheckoutWizard(page);
      await cart.proceed();
      await signIn.continueAsGuest(fakeGuest());
      await expect(billing.heading).toBeVisible();
    },
  },
  {
    name: 'checkout payment',
    path: '/checkout',
    cart: true,
    ready: (page) => [page.getByTestId('proceed-1')],
    driveInEnglish: true,
    drive: async (page) => {
      const { cart, signIn, billing, payment } = new CheckoutWizard(page);
      await cart.proceed();
      await signIn.continueAsGuest(fakeGuest());
      await billing.enterAddress(fakeAddress());
      await billing.proceed();
      await payment.choose('credit-card');
      // Invalid input, so the card field's validation message is read too.
      await payment.field('Credit Card Number').fill('abc');
      await payment.field('Credit Card Number').blur();
      await expect(payment.validationMessage('Invalid card number format.')).toBeVisible();
    },
  },
  { name: 'contact with errors', path: '/contact', ready: (page) => [page.getByTestId('contact-submit')], submit: { button: 'contact-submit', error: 'first-name-error' } },
  { name: 'login with errors', path: '/auth/login', ready: (page) => [page.getByTestId('login-submit')], submit: { button: 'login-submit', error: 'email-error' } },
  { name: 'registration with errors', path: '/auth/register', ready: (page) => [page.getByTestId('register-submit')], submit: { button: 'register-submit', error: 'first-name-error' } },
  { name: 'forgot password', path: '/auth/forgot-password', ready: (page) => [page.getByTestId('forgot-password-submit')] },
  { name: 'privacy policy', path: '/privacy', ready: (page) => [page.getByRole('heading', { level: 1 })] },
  {
    name: 'chat open',
    path: '/',
    ready: (page) => [page.getByTestId('chat-toggle')],
    drive: async (page) => {
      await page.getByTestId('chat-toggle').click();
      await expect(page.getByTestId('chat-window')).toBeVisible();
    },
  },
  {
    name: 'language menu open',
    path: '/',
    ready: (page) => [page.getByTestId('language-select')],
    drive: async (page) => {
      await page.getByTestId('language-select').click();
      await expect(page.getByTestId('lang-en')).toBeVisible();
    },
  },
];


const visitNamed = (name: string): Visit => {
  const visit = VISITS.find((v) => v.name === name);
  if (!visit) throw new Error(`No visit named "${name}"`);
  return visit;
};

const pathOf = (visit: Visit, catalog: Catalog): Promise<string> | string => (typeof visit.path === 'string' ? visit.path : visit.path(catalog));

/**
 * The UI text of the page as a returning visitor who chose `language` sees it, once its own
 * content is there, the language is applied and the text has stopped changing. Reusable on one
 * page: the cart, if the visit has one, stays in the tab.
 */
async function textIn(page: Page, language: Language, visit: Visit, path: string): Promise<UiText[]> {
  // The steps of a visit that runs in English start there, and the language menu switches afterwards.
  const startsIn = visit.driveInEnglish ? 'en' : language;
  await startInLanguage(page, startsIn);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await skipIfBotChallenge(page);
  await expect(page.locator('html')).toHaveAttribute('lang', startsIn);
  for (const content of visit.ready(page)) await expect(content.first()).toBeVisible();
  if (visit.submit) {
    await page.getByTestId(visit.submit.button).click();
    await expect(page.getByTestId(visit.submit.error).first()).toBeVisible();
  }
  await visit.drive?.(page);
  if (startsIn !== language) {
    await page.getByTestId('language-select').click();
    await page.getByTestId(`lang-${language}`).click();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
  }
  // Language-specific evidence that the translation file is applied, not only that the page has rendered.
  await expect(page.getByTestId('nav-sign-in')).toHaveText(SIGN_IN[language]);
  return settledUiText(page);
}

/** The same visit in English and in `language`, on one page, English first. */
async function bothRenderings(page: Page, language: Language, visit: Visit, catalog: Catalog, seedCart: ApiFixtures['seedCart']): Promise<{ english: Set<string>; texts: UiText[] }> {
  const path = await pathOf(visit, catalog);
  if (visit.cart) await seedCart([{ product: await catalog.inStock(), quantity: 1 }]);
  const english = new Set((await textIn(page, 'en', visit, path)).map(sameKey));
  return { english, texts: await textIn(page, language, visit, path) };
}

const sameKey = (t: UiText) => `${t.kind}\u0000${t.text}`;
const isKnown = (t: UiText, visit: Visit, language: Language) =>
  KNOWN.some(
    (k) =>
      (k.everywhere || k.visit === visit.name || k.also?.includes(visit.name)) &&
      (!k.languages || k.languages.includes(language)) &&
      (!k.pageOnly || t.part === 'page') &&
      (k.kinds ?? ['text']).includes(t.kind) &&
      k.text.test(t.text),
  );
/** The shop's name and version stand alone as the title of the home page, in every language. */
const SHOP_TITLE = /^Practice Software Testing - Toolshop - v[\d.]+$/;
const isShared = (t: UiText, visit: Visit, language: Language) =>
  SAME_IN_EVERY_LANGUAGE.includes(t.text) ||
  !!SAME_AS_ENGLISH[language]?.includes(t.text) ||
  (t.kind === 'page-title' && (SHOP_TITLE.test(t.text) || !!visit.dataTitle));

test.describe('Translations are complete', { tag: ['@i18n'] }, () => {
  for (const visit of VISITS) {
    for (const language of LANGUAGES) {
      test(`${visit.name} in ${language}: no translation key leaks`, async ({ page, catalog, seedCart }) => {
        if (visit.cart) await seedCart([{ product: await catalog.inStock(), quantity: 1 }]);
        const texts = await textIn(page, language, visit, await pathOf(visit, catalog));

        expect(untranslatedKeys(texts.map((t) => t.text)), `translation keys shown on ${visit.name} in ${language}`).toEqual([]);
      });

      if (language === 'en') continue;
      test(`${visit.name} in ${language}: no stray English`, async ({ page, catalog, seedCart }) => {
        const { english, texts } = await bothRenderings(page, language, visit, catalog, seedCart);

        const stray = texts.filter((t) => english.has(sameKey(t)) && !isShared(t, visit, language) && !isKnown(t, visit, language)).map(describeUiText);

        expect(stray, `English text left on ${visit.name} in ${language}`).toEqual([]);
      });
    }
  }
});

test.describe('Known untranslated text', { tag: ['@i18n', '@bug'] }, () => {
  for (const known of KNOWN) {
    const language = known.languages?.[0] ?? 'de';
    test(`${known.id}: ${known.title} is translated`, async ({ page, catalog, seedCart }) => {
      knownBug(known.id, known.summary);
      const visit = visitNamed(known.visit);
      const { english, texts } = await bothRenderings(page, language, visit, catalog, seedCart);

      // Identical to the English rendering: a fixed site shows nothing here, and so does a renamed string.
      const stillEnglish = texts
        .filter((t) => english.has(sameKey(t)) && (!known.pageOnly || t.part === 'page') && (known.kinds ?? ['text']).includes(t.kind) && known.text.test(t.text))
        .map(describeUiText);

      expect(stillEnglish, `${known.id}: ${known.title} is still English in ${language}`).toEqual([]);
    });
  }
});

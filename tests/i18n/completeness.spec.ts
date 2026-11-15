import { CheckoutWizard } from '@components/checkout/CheckoutWizard';
import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, mock, test } from '@fixtures';
import type { ApiFixtures, Catalog } from '@fixtures/api';
import { postcodeLookupMock } from '@fixtures/pages';
import type { Locator, Page } from '@playwright/test';
import type { ApiMock, MockRoute } from '@support/api-mock';
import { skipIfBotChallenge } from '@support/bot-challenge';
import { KNOWN, languagesOf } from '@support/i18n-baseline';
import {
  REFERENCE_NUMBER,
  SAME_IN_EVERY_LANGUAGE,
  describeUiText,
  isSharedWithEnglish,
  settledUiText,
  startInLanguage,
  untranslatedKeys,
  watchDataTraffic,
  type UiText,
} from '@support/i18n';
import { knownBug } from '@support/known-bug';
import { fakeJwt, fakeUser, page as listOf } from '@support/payloads';
import { installToken } from '@support/session';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * Every public page and key state in all seven languages. A page fails on a leaked translation
 * key ("nav.home") or on English text that should have been translated: text, attributes
 * (placeholder, aria-label, title, alt, button values), the document title and options identical
 * to the English rendering of the same page, minus the shop's data and legitimate shared words (support/i18n.ts).
 * One test per page, language and check, so the report names each defect on its own row.
 * Untranslated text known today is listed in KNOWN (src/support/i18n-baseline.ts) and pinned once
 * per defect and language below.
 * @i18n: Chromium only (playwright.config.ts); translation files do not depend on the engine.
 */
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
  /** The page needs two products selected for comparison, as the comparison bar leaves them in the tab. */
  compared?: boolean;
  /** A customer is signed in (the mocked session of fixtures/auth.ts): nothing reaches the real auth API. */
  signedIn?: boolean;
  /** Answers for the endpoints the page or its steps call, so a state that needs a failure or a write needs no real one. */
  mocks?: MockRoute[];
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

/** The header's "Categories" menu in each language: proof that the translation file is in, whatever else is on the page (signed in or not). */
const CATEGORIES_MENU: Record<Language, string> = { de: 'Kategorien', el: 'Κατηγορίες', en: 'Categories', es: 'Categorías', fr: 'Catégories', nl: 'Categorieën', tr: 'Kategoriler' };

/** An empty page of each list the account pages ask for, and the two-factor setup the profile starts. */
const accountData = [
  mock.respond('GET', '/favorites', []),
  mock.respond('GET', '/invoices', listOf([])),
  mock.respond('GET', '/messages', listOf([])),
  mock.respond('POST', '/totp/setup', {}),
];

/** The guest invoice the order is confirmed with, shaped like the real API's answer. */
const guestInvoice = { id: '01QALABFAKEINVOICE0000000', invoice_number: 'INV-2026999998' };

const VISITS: Visit[] = [
  {
    name: 'home',
    path: '/',
    ready: (page) => [page.getByTestId('product-name'), page.getByTestId(/^category-/), page.getByTestId(/^brand-/), page.getByTestId('pagination-next')],
  },
  {
    name: 'search without results',
    path: '/',
    ready: (page) => [page.getByTestId('product-name'), page.getByTestId('search-query')],
    drive: async (page) => {
      await page.getByTestId('search-query').fill('qa-lab-no-such-product');
      await page.getByTestId('search-submit').click();
      await expect(page.getByTestId('no-results')).toBeVisible();
    },
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
  { name: 'category page', dataTitle: true, path: async (catalog) => `/category/${(await catalog.inStock()).category.slug}`, ready: (page) => [page.getByTestId('page-title'), page.getByTestId('product-name')] },
  { name: 'rentals', path: '/rentals', ready: (page) => [page.getByTestId('page-title'), page.getByTestId(/^product-[0-9A-Z]{26}$/)] },
  { name: 'empty comparison', path: '/comparison', ready: (page) => [page.getByTestId('comparison-empty')] },
  { name: 'comparison with products', path: '/comparison', compared: true, ready: (page) => [page.getByTestId('comparison-table'), page.getByTestId('remove-product')] },
  // An empty cart renders only the four numbered steps of the wizard, the last of them numbered 4 whatever the language calls it.
  { name: 'empty cart', path: '/checkout', ready: (page) => [page.getByRole('listitem').filter({ hasText: /^\D*4$/ })] },
  { name: 'cart with a product', path: '/checkout', cart: true, ready: (page) => [page.getByTestId('proceed-1')] },
  {
    name: 'checkout billing',
    path: '/checkout',
    cart: true,
    ready: (page) => [page.getByTestId('proceed-1')],
    driveInEnglish: true,
    mocks: [postcodeLookupMock],
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
    mocks: [postcodeLookupMock],
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
  {
    name: 'order confirmation',
    path: '/checkout',
    cart: true,
    ready: (page) => [page.getByTestId('proceed-1')],
    driveInEnglish: true,
    // The check and the order are writes: answered by mocks, so no order is ever placed.
    mocks: [postcodeLookupMock, mock.respond('POST', '/payment/check', { message: 'Payment was successful' }), mock.respond('POST', '/invoices/guest', guestInvoice, 201)],
    drive: async (page) => {
      const checkout = new CheckoutWizard(page);
      await checkout.cart.proceed();
      await checkout.signIn.continueAsGuest(fakeGuest());
      await checkout.billing.enterAddress(fakeAddress());
      await checkout.billing.proceed();
      await checkout.payment.payOnDelivery();
      await expect(checkout.confirmation).toBeVisible();
    },
  },
  { name: 'contact with errors', path: '/contact', ready: (page) => [page.getByTestId('contact-submit')], submit: { button: 'contact-submit', error: 'first-name-error' } },
  { name: 'login with errors', path: '/auth/login', ready: (page) => [page.getByTestId('login-submit')], submit: { button: 'login-submit', error: 'email-error' } },
  {
    name: 'login refused',
    path: '/auth/login',
    ready: (page) => [page.getByTestId('login-submit')],
    // The body the real API answers unknown credentials with (401).
    mocks: [mock.fail('POST', '/users/login', 401, { error: 'Unauthorized' })],
    drive: async (page) => {
      // By test id, so the steps work in any language.
      await page.getByTestId('email').fill('nobody@example.invalid');
      await page.getByTestId('password').fill('not-a-real-password');
      await page.getByTestId('login-submit').click();
      await expect(page.getByTestId('login-error')).toBeVisible();
    },
  },
  { name: 'registration with errors', path: '/auth/register', ready: (page) => [page.getByTestId('register-submit')], submit: { button: 'register-submit', error: 'first-name-error' } },
  { name: 'forgot password', path: '/auth/forgot-password', ready: (page) => [page.getByTestId('forgot-password-submit')] },
  {
    name: 'forgot password sent',
    path: '/auth/forgot-password',
    ready: (page) => [page.getByTestId('forgot-password-submit')],
    mocks: [mock.respond('POST', '/users/forgot-password', { success: true })],
    // By test id and in the page's own language, with no switch afterwards: the confirmation fades out after three seconds.
    drive: async (page) => {
      await page.getByTestId('email').fill(fakeUser.email);
      await page.getByTestId('forgot-password-submit').click();
      await expect(page.getByRole('alert')).toBeVisible();
    },
  },
  { name: 'privacy policy', path: '/privacy', ready: (page) => [page.getByRole('heading', { level: 1 })] },
  { name: 'account', path: '/account', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title'), page.getByTestId('nav-favorites')] },
  { name: 'account favorites', path: '/account/favorites', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title')] },
  { name: 'account invoices', path: '/account/invoices', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title')] },
  { name: 'account messages', path: '/account/messages', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title')] },
  { name: 'account profile', path: '/account/profile', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title'), page.getByTestId('update-profile-submit')] },
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

interface Arrangement {
  page: Page;
  apiMock: ApiMock;
  catalog: Catalog;
  seedCart: ApiFixtures['seedCart'];
}

/**
 * What the visit needs before its page opens: the session, the answers, the comparison and the
 * cart. Done once per test, whatever the number of renderings. Returns the path to open.
 */
async function arrange(visit: Visit, { page, apiMock, catalog, seedCart }: Arrangement): Promise<string> {
  if (visit.signedIn) {
    await installToken(page, fakeJwt());
    await apiMock.use(mock.respond('GET', '/users/me', fakeUser));
  }
  if (visit.mocks) await apiMock.use(...visit.mocks);
  if (visit.compared) {
    const ids = [(await catalog.inStock()).id, (await catalog.outOfStock()).id];
    await page.addInitScript((ids) => sessionStorage.setItem('compare_ids', JSON.stringify(ids)), ids);
  }
  if (visit.cart) await seedCart([{ product: await catalog.inStock(), quantity: 1 }]);
  return typeof visit.path === 'string' ? visit.path : visit.path(catalog);
}

/**
 * The UI text of the page as a returning visitor who chose `language` sees it, once its own
 * content is there, the language is applied and the text has stopped changing. A visit whose steps
 * run in English (`driveInEnglish`) also reads the English text just before it switches, as `english`:
 * the same page in both languages, which a visit that cannot be repeated (an order consumes the cart) needs.
 */
async function readPage(page: Page, language: Language, visit: Visit, path: string): Promise<{ texts: UiText[]; english?: UiText[] }> {
  // The steps of a visit that runs in English start there, and the language menu switches afterwards.
  const startsIn = visit.driveInEnglish ? 'en' : language;
  // Watched from before the navigation, so the settled read knows when the page's own requests are answered.
  const traffic = watchDataTraffic(page);
  try {
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
    let english: UiText[] | undefined;
    if (startsIn !== language) {
      await expect(page.getByTestId('nav-categories')).toHaveText(CATEGORIES_MENU.en);
      english = await settledUiText(page, traffic);
      await page.getByTestId('language-select').click();
      await page.getByTestId(`lang-${language}`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
    }
    // Language-specific evidence that the translation file is applied, not only that the page has rendered.
    await expect(page.getByTestId('nav-categories')).toHaveText(CATEGORIES_MENU[language]);
    return { texts: await settledUiText(page, traffic), english };
  } finally {
    traffic.stop();
  }
}

/** The same visit in English and in `language`: one page, English first, unless the visit's steps run in English and give both. */
async function bothRenderings(language: Language, visit: Visit, arrangement: Arrangement): Promise<{ english: Set<string>; texts: UiText[] }> {
  const { page } = arrangement;
  const path = await arrange(visit, arrangement);
  if (visit.driveInEnglish) {
    const { texts, english } = await readPage(page, language, visit, path);
    return { english: new Set(english!.map(sameKey)), texts };
  }
  const english = new Set((await readPage(page, 'en', visit, path)).texts.map(sameKey));
  return { english, texts: (await readPage(page, language, visit, path)).texts };
}

const sameKey = (t: UiText) => `${t.kind}\u0000${t.text}`;
/** `leaksKey` asks only for the pinned raw-key leaks, which are shown in English too: every language counts. */
const isKnown = (t: UiText, visit: Visit, language: Language, { leaksKey = false } = {}) =>
  KNOWN.some(
    (k) =>
      (!leaksKey || k.leaksKey) &&
      (k.everywhere || k.visit === visit.name || k.also?.includes(visit.name)) &&
      (leaksKey || languagesOf(k).includes(language)) &&
      (!k.pageOnly || t.part === 'page') &&
      (k.kinds ?? ['text']).includes(t.kind) &&
      k.text.test(t.text),
  );
/** The shop's name and version stand alone as the title of the home page, in every language. */
const SHOP_TITLE = /^Practice Software Testing - Toolshop - v[\d.]+$/;
const isShared = (t: UiText, visit: Visit, language: Language) =>
  SAME_IN_EVERY_LANGUAGE.includes(t.text) || REFERENCE_NUMBER.test(t.text) || isSharedWithEnglish(language, t) || (t.kind === 'page-title' && (SHOP_TITLE.test(t.text) || !!visit.dataTitle));

test.describe('Translations are complete', { tag: ['@i18n'] }, () => {
  for (const visit of VISITS) {
    for (const language of LANGUAGES) {
      test(`${visit.name} in ${language}: no translation key leaks`, async ({ page, apiMock, catalog, seedCart }) => {
        const path = await arrange(visit, { page, apiMock, catalog, seedCart });
        const { texts } = await readPage(page, language, visit, path);
        // A leak a pin reports (the text IS the key) is that pin's to fail on, not this check's.
        const unpinned = texts.filter((t) => !isKnown(t, visit, language, { leaksKey: true }));

        expect(untranslatedKeys(unpinned.map((t) => t.text)), `translation keys shown on ${visit.name} in ${language}`).toEqual([]);
      });

      if (language === 'en') continue;
      test(`${visit.name} in ${language}: no stray English`, async ({ page, apiMock, catalog, seedCart }) => {
        const { english, texts } = await bothRenderings(language, visit, { page, apiMock, catalog, seedCart });

        const stray = texts.filter((t) => english.has(sameKey(t)) && !isShared(t, visit, language) && !isKnown(t, visit, language)).map(describeUiText);

        expect(stray, `English text left on ${visit.name} in ${language}`).toEqual([]);
      });
    }
  }
});

// One test per pin and language it is about: the pin and the exclusion in the stray-English checks above cover the same languages.
test.describe('Known untranslated text', { tag: ['@i18n', '@bug'] }, () => {
  for (const known of KNOWN) {
    for (const language of languagesOf(known)) {
      test(`${known.id}: ${known.title} is translated in ${language}`, async ({ page, apiMock, catalog, seedCart }) => {
        knownBug(known.id, known.summary);
        const visit = visitNamed(known.visit);
        const { english, texts } = await bothRenderings(language, visit, { page, apiMock, catalog, seedCart });

        // Identical to the English rendering: a fixed site shows nothing here, and so does a renamed string.
        const stillEnglish = texts
          .filter((t) => english.has(sameKey(t)) && (!known.pageOnly || t.part === 'page') && (known.kinds ?? ['text']).includes(t.kind) && known.text.test(t.text))
          .map(describeUiText);

        expect(stillEnglish, `${known.id}: ${known.title} is still English in ${language}`).toEqual([]);
      });
    }
  }
});

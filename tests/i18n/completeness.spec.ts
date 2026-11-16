import { CheckoutWizard } from '@components/checkout/CheckoutWizard';
import { PAYMENT_FIELDS as FIELD, PAYMENT_MESSAGES } from '@components/checkout/PaymentStep';
import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, mock, test } from '@fixtures';
import { NO_SUCH_PRODUCT } from '@fixtures/a11y';
import type { Catalog } from '@fixtures/api';
import { postcodeLookupMock } from '@fixtures/pages';
import type { ConsoleGuard } from '@fixtures/console-guard';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { ApiMock, MockRoute } from '@support/api-mock';
import { skipIfBotChallenge } from '@support/bot-challenge';
import { freezeClock } from '@support/clock';
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
  type ReadFor,
  type UiText,
} from '@support/i18n';
import { knownBug } from '@support/known-bug';
import { acceptedGuestInvoice, fakeFavorite, fakeInvoice, fakeJwt, fakeMessage, fakeUser, listOf, UNKNOWN_EMAIL, UNKNOWN_PASSWORD } from '@support/payloads';
import { installToken } from '@support/session';
import { fakeAddress, fakeGuest } from '@support/test-data';
import type { ToolshopApi } from '@support/toolshop-api';

/**
 * Every public page and key state in all seven languages. A page fails on a leaked translation
 * key ("nav.home") or on English text that should have been translated: text, attributes
 * (placeholder, aria-label, title, alt, button values), the document title and options identical
 * to the English rendering of the same page, minus the shop's data and legitimate shared words (support/i18n.ts).
 * Each rendering of a page is its own tab, so no state (an init script, a stored language, a cart) carries from one to the next.
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
  /**
   * The fewest strings of the route itself (not the header and footer) a read of this page must find, about four fifths of what it
   * showed when counted. A read that found only a few would find few defects too: the content was missed, or the page did not render.
   */
  pageStrings: number;
  /**
   * The state is a toast or a message that fades on its own timer (three to five seconds): the page's clock is frozen once the
   * witness shows it, so no read races the fade. The fade is the shop's, not the thing under test.
   */
  fades?: true;
  /** An error the page logs on purpose in this state (a refused request the shop answers as it should), declared to the console guard. */
  logs?: { pattern: RegExp; reason: string };
  /** The page needs a cart with a product in it: made through the API before the page opens. */
  cart?: boolean;
  /** The page needs two products selected for comparison, as the comparison bar leaves them in the tab. */
  compared?: boolean;
  /** A customer is signed in (the mocked session of fixtures/auth.ts): nothing reaches the real auth API. */
  signedIn?: boolean;
  /**
   * Answers for the endpoints the page or its steps call, so a state that needs a failure or a write needs no real one.
   * A function when an answer holds a product from the shop's data.
   */
  mocks?: MockRoute[] | ((catalog: Catalog) => Promise<MockRoute[]>);
  /** The document title is the name of a product or category from the shop's data, not text to translate. */
  dataTitle?: boolean;
  /** Steps that bring the opened page to the state to read, by test id so they work in any language. */
  drive?: (page: Page) => Promise<void>;
  /**
   * What shows the page is in the state `drive` brought it to (a toast, a confirmation, an error): asserted after `drive` and again
   * right after each settled sample, so a state that faded before the read (the toasts do, after three to five seconds) fails the
   * visit instead of being read as a page without it. Language-proof, because it also runs after a switch of language.
   */
  witness?: (page: Page) => Promise<void>;
  /** A phone-sized tab, with the header collapsed behind its toggler (the text of its closed menu is not drawn, so not read). */
  phone?: true;
  /**
   * The steps `drive` takes find things by their English names. They run in English, and the
   * language menu then switches the page, as a visitor who changes language half way would.
   */
  driveInEnglish?: boolean;
}

/** The header's "Categories" menu in each language: proof that the translation file is in, whatever else is on the page (signed in or not). */
const CATEGORIES_MENU: Record<Language, string> = { de: 'Kategorien', el: 'Κατηγορίες', en: 'Categories', es: 'Categorías', fr: 'Catégories', nl: 'Categorieën', tr: 'Kategoriler' };

/** A well-formed product id (26 characters) no product has: the shop's nearest error state for a product page. */
const NO_SUCH_PRODUCT_ID = '0'.repeat(26);

/** An empty page of each list the account pages ask for, and the two-factor setup the profile starts. */
const accountData = [
  mock.respond('GET', '/favorites', []),
  mock.respond('GET', '/invoices', listOf([])),
  mock.respond('GET', '/messages', listOf([])),
  mock.respond('POST', '/totp/setup', {}),
];

/** A populated list on each account page that has one, answered with the shop's own product so the rows are real-looking. */
const accountLists = async (catalog: Catalog): Promise<MockRoute[]> => {
  const product = await catalog.inStock();
  return [
    mock.respond('GET', '/favorites', [fakeFavorite(product)]),
    mock.respond('GET', '/invoices', listOf([fakeInvoice(product)])),
    mock.respond('GET', '/messages', listOf([fakeMessage])),
    mock.respond('POST', '/totp/setup', {}),
  ];
};

const VISITS: Visit[] = [
  {
    name: 'home', pageStrings: 29,
    path: '/',
    ready: (page) => [page.getByTestId('product-name'), page.getByTestId(/^category-/), page.getByTestId(/^brand-/), page.getByTestId('pagination-next')],
  },
  {
    name: 'search without results', pageStrings: 23,
    path: '/',
    ready: (page) => [page.getByTestId('product-name'), page.getByTestId('search-query')],
    drive: async (page) => {
      await page.getByTestId('search-query').fill(NO_SUCH_PRODUCT);
      await page.getByTestId('search-submit').click();
    },
    witness: (page) => expect(page.getByTestId('no-results')).toBeVisible(),
  },
  {
    name: 'product page', pageStrings: 10,
    dataTitle: true,
    path: async (catalog) => `/product/${(await catalog.inStock()).id}`,
    ready: (page) => [page.getByTestId('add-to-cart'), page.getByTestId('product-specs'), page.getByRole('heading', { level: 5 })],
  },
  {
    name: 'product page with a toast', pageStrings: 10, fades: true,
    dataTitle: true,
    path: async (catalog) => `/product/${(await catalog.inStock()).id}`,
    ready: (page) => [page.getByTestId('add-to-cart')],
    drive: async (page) => {
      await page.getByTestId('add-to-cart').click();
    },
    witness: (page) => expect(page.getByRole('alert').first()).toBeVisible(),
  },
  {
    name: 'product not found', pageStrings: 1,
    logs: { pattern: /^Failed to load resource: the server responded with a status of 500/, reason: 'the one request this visit makes that fails is the related products of an id the shop does not know: it answers 500, and the browser logs the failed request' },
    // There is no 404 page: an unknown route redirects home (BUG-02). An unknown product id is the nearest error state.
    path: `/product/${NO_SUCH_PRODUCT_ID}`,
    // All the page draws is the "Related products" heading.
    ready: (page) => [page.getByRole('heading', { level: 2 })],
  },
  { name: 'category page', pageStrings: 16, dataTitle: true, path: async (catalog) => `/category/${(await catalog.inStock()).category.slug}`, ready: (page) => [page.getByTestId('page-title'), page.getByTestId('product-name')] },
  { name: 'rentals', pageStrings: 1, path: '/rentals', ready: (page) => [page.getByTestId('page-title'), page.getByTestId(/^product-[0-9A-Z]{26}$/)] },
  { name: 'empty comparison', pageStrings: 3, path: '/comparison', ready: (page) => [page.getByTestId('comparison-empty')] },
  { name: 'comparison with products', pageStrings: 12, path: '/comparison', compared: true, ready: (page) => [page.getByTestId('comparison-table'), page.getByTestId('remove-product')] },
  // An empty cart renders only the four numbered steps of the wizard, the last of them numbered 4 whatever the language calls it.
  { name: 'empty cart', pageStrings: 4, path: '/checkout', ready: (page) => [page.getByRole('listitem').filter({ hasText: /^\D*4$/ })] },
  { name: 'cart with a product', pageStrings: 9, path: '/checkout', cart: true, ready: (page) => [page.getByTestId('proceed-1')] },
  {
    name: 'checkout billing', pageStrings: 14,
    path: '/checkout',
    cart: true,
    ready: (page) => [page.getByTestId('proceed-1')],
    driveInEnglish: true,
    mocks: [postcodeLookupMock],
    drive: async (page) => {
      const { cart, signIn } = new CheckoutWizard(page);
      await cart.proceed();
      await signIn.continueAsGuest(fakeGuest());
    },
    // The step's own button: the heading's name is English.
    witness: (page) => expect(page.getByTestId('proceed-3')).toBeVisible(),
  },
  {
    name: 'checkout payment', pageStrings: 19,
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
      await payment.field(FIELD.cardNumber).fill('abc');
      await payment.field(FIELD.cardNumber).blur();
      await expect(payment.validationMessage(PAYMENT_MESSAGES.cardNumber)).toBeVisible();
    },
    // By test id and class, because the message and the label are translated (or not) by language: the field is the one the message is about.
    witness: (page) => expect(page.getByTestId('credit_card_number')).toHaveClass(/ng-invalid/),
  },
  {
    name: 'order confirmation', pageStrings: 7,
    path: '/checkout',
    cart: true,
    ready: (page) => [page.getByTestId('proceed-1')],
    driveInEnglish: true,
    // The check and the order are writes: answered by mocks, so no order is ever placed.
    mocks: [postcodeLookupMock, mock.respond('POST', '/payment/check', { message: 'Payment was successful' }), mock.respond('POST', '/invoices/guest', acceptedGuestInvoice, 201)],
    drive: async (page) => {
      const checkout = new CheckoutWizard(page);
      await checkout.cart.proceed();
      await checkout.signIn.continueAsGuest(fakeGuest());
      await checkout.billing.enterAddress(fakeAddress());
      await checkout.billing.proceed();
      await checkout.payment.payOnDelivery();
    },
    // The invoice number the mock issued: the sentence around it is translated.
    witness: (page) => expect(page.getByText(acceptedGuestInvoice.invoice_number)).toBeVisible(),
  },
  { name: 'contact with errors', pageStrings: 21, path: '/contact', ready: (page) => [page.getByTestId('contact-submit')], submit: { button: 'contact-submit', error: 'first-name-error' } },
  { name: 'login with errors', pageStrings: 15, path: '/auth/login', ready: (page) => [page.getByTestId('login-submit')], submit: { button: 'login-submit', error: 'email-error' } },
  {
    name: 'login refused', pageStrings: 14,
    path: '/auth/login',
    ready: (page) => [page.getByTestId('login-submit')],
    // The body the real API answers unknown credentials with (401).
    mocks: [mock.fail('POST', '/users/login', 401, { error: 'Unauthorized' })],
    drive: async (page) => {
      // By test id, so the steps work in any language.
      await page.getByTestId('email').fill(UNKNOWN_EMAIL);
      await page.getByTestId('password').fill(UNKNOWN_PASSWORD);
      await page.getByTestId('login-submit').click();
    },
    witness: (page) => expect(page.getByTestId('login-error')).toBeVisible(),
  },
  { name: 'registration with errors', pageStrings: 42, path: '/auth/register', ready: (page) => [page.getByTestId('register-submit')], submit: { button: 'register-submit', error: 'first-name-error' } },
  { name: 'forgot password', pageStrings: 4, path: '/auth/forgot-password', ready: (page) => [page.getByTestId('forgot-password-submit')] },
  {
    name: 'forgot password sent', pageStrings: 4, fades: true,
    path: '/auth/forgot-password',
    ready: (page) => [page.getByTestId('forgot-password-submit')],
    mocks: [mock.respond('POST', '/users/forgot-password', { success: true })],
    // By test id and in the page's own language, with no switch afterwards: the confirmation fades out after three seconds.
    drive: async (page) => {
      await page.getByTestId('email').fill(fakeUser.email);
      await page.getByTestId('forgot-password-submit').click();
    },
    // Visible in the final settled sample too: it fades out after three seconds, so a slow read must fail here, not read the page without it.
    witness: (page) => expect(page.getByRole('alert')).toBeVisible(),
  },
  { name: 'privacy policy', pageStrings: 16, path: '/privacy', ready: (page) => [page.getByRole('heading', { level: 1 })] },
  { name: 'account', pageStrings: 5, path: '/account', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title'), page.getByTestId('nav-favorites')] },
  { name: 'account favorites', pageStrings: 2, path: '/account/favorites', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title')] },
  { name: 'account invoices', pageStrings: 4, path: '/account/invoices', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title')] },
  { name: 'account messages', pageStrings: 4, path: '/account/messages', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title')] },
  { name: 'account favorites with items', pageStrings: 1, path: '/account/favorites', signedIn: true, mocks: accountLists, ready: (page) => [page.getByTestId('page-title'), page.getByTestId(/^favorite-/)] },
  { name: 'account invoices with items', pageStrings: 5, path: '/account/invoices', signedIn: true, mocks: accountLists, ready: (page) => [page.getByTestId('page-title'), page.getByRole('row').nth(1)] },
  { name: 'account messages with items', pageStrings: 6, path: '/account/messages', signedIn: true, mocks: accountLists, ready: (page) => [page.getByTestId('page-title'), page.getByRole('row').nth(1)] },
  { name: 'account profile', pageStrings: 28, path: '/account/profile', signedIn: true, mocks: accountData, ready: (page) => [page.getByTestId('page-title'), page.getByTestId('update-profile-submit')] },
  {
    name: 'chat open', pageStrings: 29,
    path: '/',
    ready: (page) => [page.getByTestId('chat-toggle')],
    drive: async (page) => {
      await page.getByTestId('chat-toggle').click();
    },
    witness: (page) => expect(page.getByTestId('chat-window')).toBeVisible(),
  },
  {
    name: 'language menu open', pageStrings: 29,
    path: '/',
    ready: (page) => [page.getByTestId('language-select')],
    drive: async (page) => {
      await page.getByTestId('language-select').click();
    },
    witness: (page) => expect(page.getByTestId('lang-en')).toBeVisible(),
  },
  {
    name: 'home on a phone', pageStrings: 13,
    path: '/',
    phone: true,
    // The header's menu is closed behind its toggler: the page itself is what proves the translation file is in (the categories menu is in the closed menu, read by its text content).
    ready: (page) => [page.getByTestId('product-name'), page.getByTestId('pagination-next')],
  },
];

/** A phone: below 992 px the header folds behind its toggler. */
const PHONE = { width: 390, height: 844 };

const visitNamed = (name: string): Visit => {
  const visit = VISITS.find((v) => v.name === name);
  if (!visit) throw new Error(`No visit named "${name}"`);
  return visit;
};

interface Arrangement {
  context: BrowserContext;
  consoleGuard: ConsoleGuard;
  apiMock: ApiMock;
  catalog: Catalog;
  api: ToolshopApi;
}

/** What a visit needs, done once: the path to open and a way to open it in a fresh tab. */
interface Scene {
  path: string;
  /** A new tab as a returning visitor who chose `language` would open it, with the visit's session, comparison and cart in place. */
  open: (language: Language) => Promise<Page>;
}

/**
 * What the visit needs before its page opens: the answers, the session, the comparison and the
 * cart. Done once per test, whatever the number of renderings; each rendering then opens its own
 * tab, so nothing a rendering stored or scripted reaches the next.
 */
async function arrange(visit: Visit, { context, consoleGuard, apiMock, catalog, api }: Arrangement): Promise<Scene> {
  const token = fakeJwt();
  // The clock belongs to the context, so every tab of the visit has it from its first script on: it runs as usual until `freezeClock`.
  if (visit.fades) await context.clock.install();
  if (visit.logs) consoleGuard.allow(visit.logs.pattern, visit.logs.reason);
  if (visit.signedIn) await apiMock.use(mock.respond('GET', '/users/me', fakeUser));
  if (visit.mocks) await apiMock.use(...(typeof visit.mocks === 'function' ? await visit.mocks(catalog) : visit.mocks));
  const ids = visit.compared ? [(await catalog.inStock()).id, (await catalog.outOfStock()).id] : undefined;
  // A tab holds one cart: made through the API, then put in each tab's session storage once (the order consumes it).
  const cartId = visit.cart ? await api.createCart([{ product: await catalog.inStock(), quantity: 1 }]) : undefined;
  const path = typeof visit.path === 'string' ? visit.path : await visit.path(catalog);
  return {
    path,
    open: async (language) => {
      const page = await context.newPage();
      if (visit.phone) await page.setViewportSize(PHONE);
      await startInLanguage(page, language);
      if (visit.signedIn) await installToken(page, token);
      if (ids) await page.addInitScript((ids) => sessionStorage.setItem('compare_ids', JSON.stringify(ids)), ids);
      if (cartId) {
        await page.addInitScript((cartId) => {
          if (sessionStorage.getItem('qa-lab-cart-seeded')) return;
          sessionStorage.setItem('qa-lab-cart-seeded', '1');
          sessionStorage.setItem('cart_id', cartId);
          sessionStorage.setItem('cart_quantity', '1');
        }, cartId);
      }
      return page;
    },
  };
}

/**
 * The UI text of the page as a returning visitor who chose `language` sees it, once its own
 * content is there, the language is applied and the text has stopped changing. A visit whose steps
 * run in English (`driveInEnglish`) also reads the English text just before it switches, as `english`:
 * the same page in both languages, which a visit that cannot be repeated (an order consumes the cart) needs.
 * The tab is closed when the read is done.
 */
async function readPage(language: Language, visit: Visit, scene: Scene, readFor: ReadFor): Promise<{ texts: UiText[]; english?: UiText[] }> {
  // The steps of a visit that runs in English start there, and the language menu switches afterwards.
  const startsIn = visit.driveInEnglish ? 'en' : language;
  const page = await scene.open(startsIn);
  // Watched from before the navigation, so the settled read knows when the page's own requests are answered.
  const traffic = watchDataTraffic(page);
  try {
    await page.goto(scene.path, { waitUntil: 'domcontentloaded' });
    await skipIfBotChallenge(page);
    await expect(page.locator('html')).toHaveAttribute('lang', startsIn);
    for (const content of visit.ready(page)) await expect(content.first()).toBeVisible();
    if (visit.submit) {
      await page.getByTestId(visit.submit.button).click();
      await expect(page.getByTestId(visit.submit.error).first()).toBeVisible();
    }
    await visit.drive?.(page);
    await visit.witness?.(page);
    // The toast is drawn: stop its timer, so the settled reads below see it however long they take.
    if (visit.fades) await freezeClock(page);
    // The state must still be drawn when the sample is in, not only when the steps ended: before and after the read bracket it.
    const sample = async () => {
      const read = await settledUiText(page, traffic, readFor);
      await visit.witness?.(page);
      return read;
    };
    let english: UiText[] | undefined;
    if (startsIn !== language) {
      await expect(page.getByTestId('nav-categories')).toHaveText(CATEGORIES_MENU.en);
      english = await sample();
      expectPageText(english, visit, 'en');
      await page.getByTestId('language-select').click();
      await page.getByTestId(`lang-${language}`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
    }
    // Language-specific evidence that the translation file is applied, not only that the page has rendered.
    await expect(page.getByTestId('nav-categories')).toHaveText(CATEGORIES_MENU[language]);
    const texts = await sample();
    expectPageText(texts, visit, language);
    return { texts, english };
  } finally {
    traffic.stop();
    // A frozen clock would freeze the next tab of the visit as well: its page would never finish loading.
    if (visit.fades) await page.clock.resume();
    await page.close();
  }
}

/**
 * A read that found little of the route's own would find few defects in it: if the shell is nearly all there was,
 * the page's content was missed (or is all data), and the checks below would pass for the wrong reason.
 * Each visit says how many strings of its own it must show (`pageStrings`).
 */
function expectPageText(texts: UiText[], visit: Visit, language: Language): void {
  expect(
    texts.filter((t) => t.part === 'page').length,
    `${visit.name} in ${language}: strings of the route itself (not the header and footer) read, at least ${visit.pageStrings}`,
  ).toBeGreaterThanOrEqual(visit.pageStrings);
}

/** The same visit in English and in `language`: one page, English first, unless the visit's steps run in English and give both. */
async function bothRenderings(language: Language, visit: Visit, arrangement: Arrangement): Promise<{ english: Set<string>; texts: UiText[] }> {
  const scene = await arrange(visit, arrangement);
  if (visit.driveInEnglish) {
    const { texts, english } = await readPage(language, visit, scene, 'strays');
    return { english: new Set(english!.map(sameKey)), texts };
  }
  const english = new Set((await readPage('en', visit, scene, 'strays')).texts.map(sameKey));
  return { english, texts: (await readPage(language, visit, scene, 'strays')).texts };
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

/** The raw keys a page shows, minus the leaks a pin reports (the text IS the key): those are that pin's to fail on, not this check's. */
const leakedKeys = (texts: UiText[], visit: Visit, language: Language): string[] =>
  untranslatedKeys(texts.filter((t) => !isKnown(t, visit, language, { leaksKey: true })).map((t) => t.text));

/** The text a page shows exactly as its English rendering does, which is neither shared wording nor a pinned defect. */
const strayEnglish = (texts: UiText[], english: Set<string>, visit: Visit, language: Language): string[] =>
  texts.filter((t) => english.has(sameKey(t)) && !isShared(t, visit, language) && !isKnown(t, visit, language)).map(describeUiText);

test.describe('Translations are complete', { tag: ['@i18n'] }, () => {
  for (const visit of VISITS) {
    for (const language of LANGUAGES) {
      test(`${visit.name} in ${language}: no translation key leaks`, async ({ context, consoleGuard, apiMock, catalog, api }) => {
        const scene = await arrange(visit, { context, consoleGuard, apiMock, catalog, api });
        // Read for keys: everything but the shop's real data, so the footer, the sliders and the shared wording are looked at too.
        const { texts } = await readPage(language, visit, scene, 'keys');
        expect(leakedKeys(texts, visit, language), `translation keys shown on ${visit.name} in ${language}`).toEqual([]);
      });

      if (language === 'en') continue;
      test(`${visit.name} in ${language}: no stray English`, async ({ context, consoleGuard, apiMock, catalog, api }) => {
        const { english, texts } = await bothRenderings(language, visit, { context, consoleGuard, apiMock, catalog, api });

        expect(strayEnglish(texts, english, visit, language), `English text left on ${visit.name} in ${language}`).toEqual([]);
      });
    }
  }
});

/**
 * The two checks above pass when nothing leaks, which they would also do if they could not see a leak. So the same reads and the same
 * verdicts run once more on a German translation file the test spoils: one key removed (the page shows the key itself) and one value
 * put back to its English wording, and one key that a page uses as an `aria-label` (the Compare button on a product card), which a read of the
 * text alone would never see. All three must be reported, and only those.
 */
test.describe('The translation checks see a spoiled file', { tag: ['@i18n'] }, () => {
  const spoiled = { removed: 'header.menu.home', english: 'header.menu.contact', label: 'pages.comparison.add' };

  test('a key missing from the German file is reported as a leak (in text and in an aria-label), and a value left in English as stray English', async ({ context, consoleGuard, apiMock, catalog, api, request }) => {
    const home = visitNamed('home');
    const english = (await (await request.get('/assets/i18n/en.json')).json()) as Record<string, unknown>;
    await context.route('**/assets/i18n/de.json', async (route) => {
      const response = await route.fetch();
      const file = (await response.json()) as Record<string, unknown>;
      const menu = (file.header as { menu: Record<string, string> }).menu;
      delete menu.home;
      delete (file.pages as { comparison: Record<string, string> }).comparison.add;
      menu.contact = (english.header as { menu: Record<string, string> }).menu.contact;
      await route.fulfill({ response, json: file });
    });
    const arrangement = { context, consoleGuard, apiMock, catalog, api };

    const { texts: keyRead } = await readPage('de', home, await arrange(home, arrangement), 'keys');
    const { english: englishRead, texts } = await bothRenderings('de', home, arrangement);

    expect(keyRead, `the key removed from the file (${spoiled.label}) is read as an aria-label`).toContainEqual(expect.objectContaining({ kind: 'aria-label', text: spoiled.label }));
    // Once per place it shows (the Compare button's aria-label and tooltip on every card), so the distinct keys are compared.
    expect([...new Set(leakedKeys(keyRead, home, 'de'))].sort(), `only the keys removed from the file (${spoiled.removed}, ${spoiled.label}) are reported`).toEqual([spoiled.removed, spoiled.label].sort());
    expect(strayEnglish(texts, englishRead, home, 'de'), `only the value put back to English (${spoiled.english}) is reported`).toEqual(['"Contact"']);
  });
});

// One test per pin and language it is about: the pin and the exclusion in the stray-English checks above cover the same languages.
test.describe('Known untranslated text', { tag: ['@i18n', '@bug'] }, () => {
  for (const known of KNOWN) {
    for (const language of languagesOf(known)) {
      test(`${known.id}: ${known.title} is translated in ${language}`, async ({ context, consoleGuard, apiMock, catalog, api }) => {
        knownBug(known.id, known.summary);
        const visit = visitNamed(known.visit);
        const { english, texts } = await bothRenderings(language, visit, { context, consoleGuard, apiMock, catalog, api });

        // Identical to the English rendering: a fixed site shows nothing here, and so does a renamed string.
        const stillEnglish = texts
          .filter((t) => english.has(sameKey(t)) && (!known.pageOnly || t.part === 'page') && (known.kinds ?? ['text']).includes(t.kind) && known.text.test(t.text))
          .map(describeUiText);

        expect(stillEnglish, `${known.id}: ${known.title} is still English in ${language}`).toEqual([]);
      });
    }
  }
});

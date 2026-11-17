import { CheckoutWizard } from '@components/checkout/CheckoutWizard';
import { PAYMENT_FIELDS as FIELD, PAYMENT_MESSAGES } from '@components/checkout/PaymentStep';
import type { Language } from '@components/LanguageSwitcher';
import { expect, mock } from '@fixtures';
import { NO_SUCH_PRODUCT } from '@fixtures/a11y';
import type { Catalog } from '@fixtures/api';
import { postcodeLookupMock } from '@fixtures/mocks';
import type { Locator, Page } from '@playwright/test';
import type { MockRoute } from '@support/api-mock';
import { acceptedGuestInvoice, fakeFavorite, fakeInvoice, fakeMessage, fakeUser, listOf, UNKNOWN_EMAIL, UNKNOWN_PASSWORD } from '@support/payloads';
import { fakeAddress, fakeGuest } from '@support/test-data';

/** The pages and states the translation checks of completeness.spec.ts visit, each with what shows it rendered and how to bring it to its state. */

export interface Visit {
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
export const CATEGORIES_MENU: Record<Language, string> = { de: 'Kategorien', el: 'Κατηγορίες', en: 'Categories', es: 'Categorías', fr: 'Catégories', nl: 'Categorieën', tr: 'Kategoriler' };

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

/** A phone: below 992 px the header folds behind its toggler. */
export const PHONE = { width: 390, height: 844 };

export const VISITS: Visit[] = [
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
  // The empty cart shows the wizard's steps and nothing else: its last step is the 4th list item. A fifth step would need this number moved with it.
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

import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import type { UiTextKind } from './i18n';

/**
 * Untranslated text the site has today, pinned once per defect by the "Known untranslated text"
 * tests in tests/i18n/completeness.spec.ts, and left out of the "no stray English" checks of the
 * visits and languages it was recorded on. A pin and its exclusion cover the same languages, so a
 * language that gets fixed turns its own pin red.
 */
export interface KnownUntranslated {
  id: string;
  /** What is untranslated, as the pin's title reads: "<title> is translated". */
  title: string;
  /** The visit the pin opens, and the only one the defect is looked for on, unless `also` or `everywhere`. */
  visit: string;
  /** Other visits that show the same element, so it is not reported again there. */
  also?: string[];
  /** Part of the header, footer or widgets: on every page. */
  everywhere?: boolean;
  /** Only in these languages; the rest translate it. Every language but English when left out. */
  languages?: Language[];
  /** Only the route's own content, not the header and footer around it. */
  pageOnly?: boolean;
  /** Which kind of UI text it is: the text itself unless stated. */
  kinds?: UiTextKind[];
  /** The text IS a translation key that leaked: the key-leak check of the visit leaves it out, because this pin reports it. */
  leaksKey?: true;
  text: RegExp;
  summary: string;
}

export const KNOWN: KnownUntranslated[] = [
  { id: 'I18N-01', title: 'the notification bar', visit: 'home', everywhere: true, text: /^(View the|Documentation|for this application\.)$/, summary: 'the notification bar ("View the Documentation for this application.") is English in every language' },
  { id: 'I18N-02', title: 'the page heading', visit: 'home', everywhere: true, text: /^Practice Software Testing - Toolshop$/, summary: 'the page heading (visually hidden, read by screen readers) is English in every language' },
  { id: 'I18N-03', title: 'the footer', visit: 'home', everywhere: true, text: /^(Privacy Policy|\| Banner photo by|on)$/, summary: 'the footer ("Privacy Policy", "Banner photo by … on Unsplash") is English in every language' },
  { id: 'I18N-04', title: '"Sign in with Google"', visit: 'login with errors', also: ['login refused'], kinds: ['text', 'aria-label'], text: /^Sign in with Google$/, summary: '"Sign in with Google" is English in every language' },
  { id: 'I18N-05', title: 'the registration and profile forms\' hints', visit: 'registration with errors', also: ['account profile'], text: /^(Please enter a valid date in YYYY-MM-DD format\.|Your password must:|Be at least 8 characters long|Contain both uppercase and lowercase letters|Include at least one number|Have at least one special symbol \(e\.g\., @, #, \$, etc\.\)|Password strength:|Weak|Moderate|Strong|Very Strong|Excellent)$/, summary: 'registration: the date-format error, the password rules and the strength meter are English in every language' },
  { id: 'I18N-06', title: 'the privacy policy', visit: 'privacy policy', pageOnly: true, text: /./, summary: 'the privacy policy page, headings and paragraphs, is English in every language' },
  { id: 'I18N-07', title: 'the product page\'s "Quantity" label', visit: 'product page', also: ['product page with a toast'], text: /^Quantity$/, summary: 'the product page\'s "Quantity" label is hard-coded English' },
  // Found by reading attributes and options too (they were never scanned before).
  { id: 'I18N-08', title: 'the logo\'s tooltip', visit: 'home', everywhere: true, languages: ['de', 'fr'], kinds: ['title'], text: /^Practice Software Testing - Toolshop$/, summary: 'the logo\'s tooltip ("Practice Software Testing - Toolshop") is English in German and French' },
  { id: 'I18N-09', title: 'the header navigation\'s labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Main menu|nav-categories|Select language)$/, summary: 'the aria-labels of the main menu, the categories menu ("nav-categories", an internal id) and the language button are English in every language' },
  { id: 'I18N-10', title: 'the floating buttons\' labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Open chat|Show live shop activity)$/, summary: 'the aria-labels of the chat and live-activity buttons are English in every language' },
  { id: 'I18N-11', title: 'the sort and price-range labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(sort|Sort products|ngx-slider|ngx-slider-max)$/, summary: 'the aria-labels of the sort list ("sort", "Sort products") and the price sliders ("ngx-slider", "ngx-slider-max", library ids) are English in every language' },
  { id: 'I18N-12', title: 'the pagination labels', visit: 'home', everywhere: true, kinds: ['aria-label'], text: /^(Previous|Next|Page-\d+)$/, summary: 'the aria-labels of the pagination buttons ("Previous", "Next", "Page-1") are English in every language' },
  { id: 'I18N-13', title: 'the login page\'s labels', visit: 'login with errors', also: ['login refused'], kinds: ['aria-label'], text: /^(Alternative login methods|Login|Forgot your Password\?|Register your account)$/, summary: 'the aria-labels on the login page (the methods group, the Login button, the forgot-password and register links) are English in every language' },
  { id: 'I18N-14', title: 'the product page\'s category and brand labels', visit: 'product page', also: ['product page with a toast'], kinds: ['aria-label'], text: /^(category|brand)$/, summary: 'the aria-labels "category" and "brand" on the product page are English ids in every language' },
  { id: 'I18N-15', title: 'the banner image\'s alt text', visit: 'home', also: ['search without results', 'chat open', 'language menu open'], kinds: ['alt'], text: /^Banner$/, summary: 'the home page banner image\'s alt text ("Banner") is English in every language' },
  // Found by reading the document title, the cart lines, the payment form and the chat window.
  { id: 'I18N-16', title: 'the page titles', visit: 'privacy policy', everywhere: true, kinds: ['page-title'], text: /^(Checkout|Login|Register|Forgot Password|Contact Us|Privacy Policy|Product Comparison|Rentals Overview|Overview|Favorites|Profile|Invoices|Messages) - Practice Software Testing - Toolshop - v[\d.]+$/, summary: 'the browser tab title of the checkout, login, register, forgot-password, contact, privacy, comparison, rentals and account pages is English in every language' },
  { id: 'I18N-17', title: 'the cart link\'s label', visit: 'cart with a product', everywhere: true, kinds: ['aria-label'], text: /^cart$/, summary: 'the aria-label of the header cart link ("cart", an internal id) is English in every language' },
  { id: 'I18N-18', title: 'the cart lines\' quantity labels', visit: 'cart with a product', text: /^Quantity for /, summary: 'the cart\'s per-line quantity label ("Quantity for <product>") is English in every language' },
  { id: 'I18N-19', title: 'the card form', visit: 'checkout payment', languages: ['de'], kinds: ['text', 'placeholder'], text: /^(Credit Card Number|Enter your 16-digit credit card number.*|Expiration Date|The CVV is a 3-digit or 4-digit number.*|Card Holder Name)$/, summary: 'the credit-card form\'s labels, hints and placeholders are English in German' },
  { id: 'I18N-20', title: 'the chat window\'s close button', visit: 'chat open', kinds: ['aria-label'], text: /^Close chat$/, summary: 'the aria-label of the chat window\'s close button ("Close chat") is English in every language' },
  // Found by visiting the states a visitor reaches after acting: a search with no hits, a refused login, a sent reset request, the account pages.
  { id: 'I18N-21', title: 'the search caption', visit: 'search without results', text: /^Searched for:$/, summary: 'the search caption ("Searched for:") above the results is English in every language' },
  { id: 'I18N-22', title: 'the refused login\'s error', visit: 'login refused', text: /^Invalid email or password$/, summary: 'the error shown for unknown credentials ("Invalid email or password") is English in every language' },
  // The same defect as BUG-20 (docs/COVERAGE.md), seen in every language: the text IS the key, so it is also what the key-leak check reports.
  { id: 'I18N-23', title: 'the forgot-password confirmation', visit: 'forgot password sent', leaksKey: true, text: /^page\.forgot-password\.confirm$/, summary: 'the forgot-password confirmation is the raw translation key "page.forgot-password.confirm" in every language (BUG-20)' },
  { id: 'I18N-24', title: 'the profile page\'s TOTP field label', visit: 'account profile', kinds: ['aria-label'], text: /^TOTP code$/, summary: 'the aria-label of the profile page\'s TOTP code field ("TOTP code") is English in every language' },
];

/** The languages a pin is about, and so the languages it is checked in, one test each. */
export const languagesOf = (known: KnownUntranslated): Language[] => known.languages ?? LANGUAGES.filter((language) => language !== 'en');

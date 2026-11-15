import { expect, type Page } from '@playwright/test';
import type { Language } from '@components/LanguageSwitcher';

/**
 * Where on the page a string of UI text was read: the text itself, or an attribute assistive
 * technology or the browser shows (an input's placeholder, a button's aria-label, a tooltip).
 */
export type UiTextKind = 'text' | 'placeholder' | 'aria-label' | 'title' | 'alt' | 'value' | 'option' | 'page-title';

export interface UiText {
  kind: UiTextKind;
  text: string;
  /** The shell (header, footer, the two floating widgets, toasts) or what the route itself renders. */
  part: 'shell' | 'page';
}

/** A string of UI text as a report line: `"Home"`, `aria-label "Select language"`. */
export const describeUiText = ({ kind, text }: UiText): string => (kind === 'text' ? `"${text}"` : `${kind} "${text}"`);

/**
 * The shop's own data and legitimate shared words: product, brand and category names,
 * descriptions, specs, prices, the country list (an ISO reference list), names of external
 * products, product images (their alt text is the product's name), the build line, and the
 * training-aid bar laid over the shop for testers. Their text and their descendants' attributes
 * are not checked. CSS, because these are containers with no
 * role to find them by.
 */
const DATA = [
  // A product's name, description, prices, and its spec table with its title.
  '[data-test="product-name"]', '[data-test="product-description"]', '[data-test="product-price"]', '[data-test="unit-price"]',
  // A product card in a grid: its test id is `product-<ULID>`, and the shop's ULIDs all start with "0".
  '[data-test^="product-0"]', '[data-test="product-title"]', '[data-test="product-specs"]',
  // A card's title (a product's or a related product's name) and the <figure> around the product page's image, whose caption credits the photographer.
  '.card-title', 'figure',
  // The filter checkboxes' labels: the names of categories and brands.
  'label:has([data-test^="category-"])', 'label:has([data-test^="brand-"])',
  // The footer's "Learn & Explore" block: names and blurbs of external training products.
  '[data-test="footer-explore"]',
  // The box around a product image: its alt text is the product's name.
  '.card-img-wrapper',
  // The country <option>s: an ISO reference list.
  '[data-test="country"]',
  // The photographer's credit in the footer, a link to an external site.
  'app-footer a[href*="unsplash"]',
  // The same block's heading and blurbs, and the build line ("vdev | Built … | Angular …"), all muted text.
  'footer .text-muted',
  // The two training-aid overlays (see EXCLUDED in fixtures/a11y.ts).
  '.testing-notification-bar', '.guide-container',
  // Never visible text, but the tree walker would read their source as text nodes.
  'script', 'style',
];

/**
 * Containers whose text is not language (a slider's numbers, the language names, a label that
 * repeats a data value) but whose own attributes are still read: an `aria-label` on them is UI.
 */
const TEXT_ONLY = ['.ngx-slider', '[data-test="language-select"]', '[data-test^="lang-"]', '[aria-label="category"]', '[aria-label="brand"]'];

/**
 * What every route shares, so text outside it is the page's own: the notification bar above the
 * header, the header, the footer, the two floating widgets and the toasts.
 */
const SHELL = ['app-root > .bg-dark', 'app-header', 'app-footer', 'app-chat-widget', 'app-live-activity-widget', '#toast-container'];

/**
 * Every string of UI a visitor can see or hear on the page, trimmed, one entry per distinct
 * string: the document title, text nodes, `placeholder`, `aria-label`, `title`, `alt`, the value of a submit or
 * button input, and the text of `<option>`s. Items of a dropdown menu are read although the menu
 * is closed (it is part of the page; its toggle must be visible). The shop's data (see DATA) is left out.
 */
export async function visibleUiText(page: Page): Promise<UiText[]> {
  return page.evaluate(
    ({ data, textOnly, shell }) => {
      const out = new Map<string, { kind: UiTextKind; text: string; part: 'shell' | 'page' }>();
      const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const inside = (el: Element, selectors: string[]) => selectors.some((s) => el.closest(s));
      const rendered = (el: Element) => {
        const style = getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0;
      };
      const shown = (el: Element) => {
        const menu = el.closest('.dropdown-menu');
        if (menu) return !!menu.parentElement && rendered(menu.parentElement);
        const select = el.closest('select');
        return rendered(select ?? el);
      };
      const add = (kind: UiTextKind, raw: string | null | undefined, el: Element, textOnlyToo: boolean) => {
        const text = clean(raw);
        // Fewer than two characters is a glyph or a unit ("x", "€", "%"), and text with no letter is a number or a symbol: neither is a word to translate.
        if (text.length < 2 || !/\p{L}/u.test(text) || inside(el, data) || !shown(el)) return;
        if (textOnlyToo && inside(el, textOnly)) return;
        out.set(`${kind}\u0000${text}`, { kind, text, part: inside(el, shell) ? 'shell' : 'page' });
      };

      add('page-title', document.title, document.body, false);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // An option's text is read once, as an option.
        if (node.parentElement && node.parentElement.tagName !== 'OPTION') add('text', node.textContent, node.parentElement, true);
      }
      for (const el of document.querySelectorAll('option')) add('option', el.textContent, el, true);
      for (const el of document.querySelectorAll('[placeholder]')) add('placeholder', el.getAttribute('placeholder'), el, false);
      for (const el of document.querySelectorAll('[aria-label]')) add('aria-label', el.getAttribute('aria-label'), el, false);
      for (const el of document.querySelectorAll('[title]')) add('title', el.getAttribute('title'), el, false);
      for (const el of document.querySelectorAll('img[alt]')) add('alt', el.getAttribute('alt'), el, false);
      for (const el of document.querySelectorAll('input[type="submit"], input[type="button"], input[type="reset"]')) add('value', el.getAttribute('value'), el, false);
      return [...out.values()];
    },
    { data: DATA, textOnly: TEXT_ONLY, shell: SHELL },
  );
}

/**
 * The UI text once it has stopped changing: two reads in a row, 250 ms apart, are the same. The
 * route's own content, the translation file and the toasts all arrive on their own schedule, so
 * a single read can be taken before they are in.
 */
export async function settledUiText(page: Page): Promise<UiText[]> {
  let previous = '';
  let latest: UiText[] = [];
  await expect
    .poll(
      async () => {
        latest = await visibleUiText(page);
        const now = JSON.stringify(latest);
        const settled = now === previous;
        previous = now;
        return settled;
      },
      { message: 'the UI text to stop changing', intervals: [250] },
    )
    .toBe(true);
  return latest;
}

/**
 * Dotted translation keys that leaked into the page ("nav.home", "page.forgot-password.confirm",
 * "errors.404.title", "page.forgotPassword", "nav.Home"): a lowercase first segment, then more
 * segments of letters, digits, "_" and "-" in any case, standing alone, so an email, a URL, a
 * price, a version or a filename inside a sentence is not one. A dot followed by a space ends a
 * sentence, so it never continues a key. Domain-like, version-like and abbreviation-like matches are dropped.
 */
const KEY = /(?<![\p{L}\p{N}@/.:_-])\p{Ll}[\p{Ll}\p{N}_-]*(?:\.[\p{L}\p{N}][\p{L}\p{N}_-]*)+(?![\p{L}\p{N}@/_-]|\.[\p{L}\p{N}])/gu;
// Abbreviations are letters in twos: e.g, i.e, d.h (German), π.χ (Greek "e.g."). A version is "v5.3.1".
const NOT_KEYS = /^\p{L}{1,2}(?:\.\p{L}{1,2})+$|^v\d+(?:\.\d+)+$|\.(?:com|dev|io|org|net|txt|png|jpg|pdf)$/iu;

export function untranslatedKeys(texts: string[]): string[] {
  return texts.flatMap((t) => t.match(KEY) ?? []).filter((k) => !NOT_KEYS.test(k));
}

/** Makes the SPA start in a language, as a returning visitor who chose it would. */
export async function startInLanguage(page: Page, language: Language): Promise<void> {
  await page.addInitScript((lang) => localStorage.setItem('language', lang), language);
}

/**
 * Words a translation legitimately shares with English: "Contact" in French and Dutch,
 * "Home" and "Item" in Dutch, "Total" in Spanish and French, "Message" in French, the loanword "Webmaster", "Name" in German.
 */
export const SAME_AS_ENGLISH: Partial<Record<Language, string[]>> = {
  de: ['Webmaster', 'Name (A - Z)', 'Name (Z - A)'],
  es: ['Webmaster', 'Total'],
  fr: ['Contact', 'Message *', 'Webmaster', 'Total'],
  nl: ['Home', 'Contact', 'Webmaster', 'Item'],
};

/**
 * Tokens that are not words of any language: the accepted file extension on the contact form,
 * the card security code's acronym, and the date format the registration form asks for (the API accepts only YYYY-MM-DD, so the
 * hint must not be localised).
 */
export const SAME_IN_EVERY_LANGUAGE = ['txt', 'YYYY-MM-DD', 'CVV'];

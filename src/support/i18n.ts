import { expect, type Page, type Request } from '@playwright/test';
import type { Language } from '@components/LanguageSwitcher';

/**
 * Where on the page a string of UI text was read: the text itself, or an attribute assistive
 * technology or the browser shows (an input's placeholder, a button's aria-label, a tooltip).
 */
export type UiTextKind =
  | 'text'
  | 'placeholder'
  | 'aria-label'
  | 'aria-description'
  | 'aria-valuetext'
  | 'aria-placeholder'
  | 'title'
  | 'alt'
  | 'value'
  | 'option'
  | 'page-title';

export interface UiText {
  kind: UiTextKind;
  text: string;
  /** The shell (header, footer, the two floating widgets, toasts) or what the route itself renders. */
  part: 'shell' | 'page';
}

/** A string of UI text as a report line: `"Home"`, `aria-label "Select language"`. */
export const describeUiText = ({ kind, text }: UiText): string => (kind === 'text' ? `"${text}"` : `${kind} "${text}"`);

/**
 * What a read skips, by what it is looking for. Both lists are CSS, because these are containers with
 * no role to find them by, and both skip an element's text and its descendants' attributes.
 *
 * Real data (DATA) is skipped by every read: product, brand and category names, descriptions, specs,
 * prices, what the visitor typed, the signed-in customer's name, product images (their alt text is the
 * product's name) and the training-aid bar laid over the shop for testers. It is never translated, and
 * its text is not the shop's, so not even a leaked key could be the shop's doing. A product card is not
 * in the list as a whole: only its name, price and image are data, so the Compare button and the stock
 * label on it are scanned.
 */
const DATA = [
  // A product's name, description, prices, and its spec table with its title.
  '[data-test="product-name"]', '[data-test="product-description"]', '[data-test="product-price"]', '[data-test="unit-price"]',
  // A cart line's product title, and the product page's spec table.
  '[data-test="product-title"]', '[data-test="product-specs"]',
  // A card's title (a product's or a related product's name) and the <figure> around the product page's image, whose caption credits the photographer.
  // Not the card itself: its Compare button, its CO2 scale and its "Out of stock" label are the shop's own text and are read.
  '.card-title', 'figure',
  // The filter checkboxes' labels: the names of categories and brands.
  'label:has([data-test^="category-"])', 'label:has([data-test^="brand-"])',
  // A card's image (in the grid, among the related products, in the rentals list): its alt text and tooltip are the product's name.
  // Not the wrapper around it, which also holds the Compare button.
  '.card img',
  // A rental's description, under its name.
  '.card-text',
  // The comparison table's data: brand, category, spec values and descriptions, the spec names that head those rows (the rows of
  // "Price", "Brand" or "Availability" are the shop's own words and are read), and the product images in its header.
  '[data-test="compare-brand"]', '[data-test="compare-category"]', '[data-test="compare-spec"]', '[data-test="compare-description"]',
  'tr:has([data-test="compare-spec"]) > th', 'img.comparison-img',
  // What the visitor typed into the search box, echoed back above the results, and the signed-in customer's name on the account menu.
  '[data-test="search-term"]', '[data-test="nav-menu"]',
  // The records of the account's lists (invoices, messages): the billing address, the subject, the message text, the dates and the
  // totals are what the customer typed or the shop stored. The Details button and the status badge in the same row, and any cell holding a control (the cart's quantity field), are the shop's own words and are read.
  '.table-hover tbody td:not(:has(a, button, input, .badge))',
  // The two training-aid overlays (see EXCLUDED in fixtures/a11y.ts).
  '.testing-notification-bar', '.guide-container',
  // Never visible text, but the tree walker would read their source as text nodes.
  'script', 'style',
];

/**
 * Wording that is legitimately the same in every language, which only the stray-English comparison
 * must not report. A leaked key there would still be a defect, so the key-leak read does not skip it:
 * the country list (an ISO reference list), the footer's "Learn & Explore" block (names and blurbs of external
 * training products), the photographer's credit (a link to an external site), and the footer's muted text
 * (that block's heading and blurbs, and the build line "vdev | Built … | Angular …").
 */
const SHARED_WORDING = ['[data-test="country"]', '[data-test="footer-explore"]', 'app-footer a[href*="unsplash"]', 'footer .text-muted'];

/** What a read is for: the comparison with English reports words left in English, the key-leak read reports raw keys. */
export type ReadFor = 'strays' | 'keys';

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
 * string: the document title, text nodes, `placeholder`, `aria-label`, `aria-description`, `aria-valuetext`,
 * `aria-placeholder`, `title`, `alt`, the value of a submit or button input, and the text of `<option>`s. Items
 * of a dropdown menu are read although the menu is closed (it is part of the page; its toggle must be visible).
 *
 * `readFor` says what the read is for. Looking for 'strays' also leaves out the shared wording and the
 * containers whose text is not language (TEXT_ONLY); looking for 'keys' leaves out only the shop's real data
 * (DATA), so a raw key standing in a footer blurb or a slider's label is still seen.
 */
export async function visibleUiText(page: Page, readFor: ReadFor = 'strays'): Promise<UiText[]> {
  const strays = readFor === 'strays';
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
      for (const el of document.querySelectorAll('[aria-description]')) add('aria-description', el.getAttribute('aria-description'), el, false);
      for (const el of document.querySelectorAll('[aria-valuetext]')) add('aria-valuetext', el.getAttribute('aria-valuetext'), el, false);
      for (const el of document.querySelectorAll('[aria-placeholder]')) add('aria-placeholder', el.getAttribute('aria-placeholder'), el, false);
      for (const el of document.querySelectorAll('[title]')) add('title', el.getAttribute('title'), el, false);
      for (const el of document.querySelectorAll('img[alt]')) add('alt', el.getAttribute('alt'), el, false);
      for (const el of document.querySelectorAll('input[type="submit"], input[type="button"], input[type="reset"]')) add('value', el.getAttribute('value'), el, false);
      return [...out.values()];
    },
    { data: strays ? [...DATA, ...SHARED_WORDING] : DATA, textOnly: strays ? TEXT_ONLY : [], shell: SHELL },
  );
}

/**
 * The shop's own data requests of a page, counted while they are in flight: `fetch` and XHR only,
 * so the live-activity widget's event stream, which never ends, is not one. The route's content,
 * the translation file (`assets/i18n/<language>.json`) and every list the page loads are such
 * requests, so "none in flight" is the page's own signal that it has what it is going to show.
 * Start it before the navigation, or the requests the page sends first are never seen.
 */
export interface DataTraffic {
  inFlight(): number;
  stop(): void;
}

export function watchDataTraffic(page: Page): DataTraffic {
  const pending = new Set<Request>();
  const isData = (request: Request) => ['fetch', 'xhr'].includes(request.resourceType());
  const started = (request: Request) => void (isData(request) && pending.add(request));
  const ended = (request: Request) => void pending.delete(request);
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return {
    inFlight: () => pending.size,
    stop: () => {
      page.off('request', started);
      page.off('requestfinished', ended);
      page.off('requestfailed', ended);
    },
  };
}

/**
 * The UI text once the page has stopped loading and changing: no data request is in flight
 * (`traffic`, from `watchDataTraffic`, when the caller watched the page from its navigation) and two
 * reads in a row, 250 ms apart, are the same. The route's own content, the translation file and the
 * toasts all arrive on their own schedule, so a single read can be taken before they are in; the
 * quiet period only covers what no request announces (a render after the last answer, a fade).
 */
export async function settledUiText(page: Page, traffic?: DataTraffic, readFor: ReadFor = 'strays'): Promise<UiText[]> {
  let previous = '';
  let latest: UiText[] = [];
  await expect
    .poll(
      async () => {
        latest = await visibleUiText(page, readFor);
        const now = JSON.stringify(latest);
        const settled = now === previous && (traffic?.inFlight() ?? 0) === 0;
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
 * "errors.404.title", "page.forgotPassword", "nav.Home", "navBar.home", "NAV.HOME", "2fa.title"):
 * segments of letters, digits, "_" and "-" in any case joined by dots, standing alone or glued to
 * punctuation ("Error:nav.home"), so an email, a URL, a price, a version or a filename inside a
 * sentence is not one. A key needs at least two segments with a letter in them, which is what
 * keeps a number ("1,234.56", "2.5kg", "0800.123.456", "v5.3.1", "17.00") from being one. A dot
 * followed by a space ends a sentence, so it never continues a key. Abbreviation-like, domain-like
 * and file-like matches are dropped (NOT_KEYS).
 */
const SEGMENT = String.raw`[\p{L}\p{N}][\p{L}\p{N}_-]*`;
const KEY = new RegExp(String.raw`(?<![\p{L}\p{N}@/._-])${SEGMENT}(?:\.${SEGMENT})+(?![\p{L}\p{N}@/_-]|\.[\p{L}\p{N}])`, 'gu');
const hasLetter = (segment: string) => /\p{L}/u.test(segment);

/** Domains the shop's own text names: its demo shop, its maker, the reserved example domains and the training links. */
const SHOWN_DOMAINS = ['practicesoftwaretesting.com', 'testsmith.io', 'example.com', 'example.org', 'github.com', 'unsplash.com'];
// Abbreviations are letters in twos: e.g, i.e, d.h (German), π.χ (Greek "e.g."). Anything else dotted that
// is no key is a hostname of SHOWN_DOMAINS (itself or a subdomain) or a file name with one of the extensions the contact form accepts or the shop serves.
const NOT_KEYS = new RegExp(
  String.raw`^\p{L}{1,2}(?:\.\p{L}{1,2})+$|^(?:[\p{L}\p{N}-]+\.)*(?:${SHOWN_DOMAINS.map((d) => d.replace(/\./g, String.raw`\.`)).join('|')})$|^[\p{L}\p{N}_-]+\.(?:txt|png|jpg|pdf)$`,
  'iu',
);

export function untranslatedKeys(texts: string[]): string[] {
  return texts.flatMap((t) => t.match(KEY) ?? []).filter((k) => k.split('.').filter(hasLetter).length >= 2 && !NOT_KEYS.test(k));
}

/** Makes the SPA start in a language, as a returning visitor who chose it would. */
export async function startInLanguage(page: Page, language: Language): Promise<void> {
  await page.addInitScript((lang) => localStorage.setItem('language', lang), language);
}

/** A word a translation shares with English, and the kinds of UI text it is allowed as: "Total" as a label is shared, "Total" as a button's `aria-label` is not looked at here. */
export interface SharedWord {
  text: string;
  kinds: UiTextKind[];
}

/**
 * Words a translation legitimately shares with English: "Contact" in French and Dutch,
 * "Home" and "Item" in Dutch, "Total" in Spanish and French, "Message(s)", "Date" and "Description" in French, "Details" and "Status" in German and Dutch, the loanword "Webmaster", "Name" in German.
 * Per language and per kind: a word shared as visible text says nothing about the same word
 * left in a tooltip or an aria-label, which a visitor who changed language also expects translated.
 */
export const SAME_AS_ENGLISH: Partial<Record<Language, SharedWord[]>> = {
  de: [
    { text: 'Webmaster', kinds: ['text', 'option'] },
    { text: 'Name (A - Z)', kinds: ['option'] },
    { text: 'Name (Z - A)', kinds: ['option'] },
    { text: 'Details', kinds: ['text'] },
    { text: 'Status', kinds: ['text'] },
  ],
  es: [{ text: 'Webmaster', kinds: ['text', 'option'] }, { text: 'Total', kinds: ['text'] }],
  fr: [
    { text: 'Contact', kinds: ['text'] },
    { text: 'Message *', kinds: ['text'] },
    { text: 'Messages', kinds: ['text'] },
    { text: 'Message', kinds: ['text'] },
    { text: 'Date', kinds: ['text'] },
    { text: 'Description', kinds: ['text'] },
    { text: 'Webmaster', kinds: ['text', 'option'] },
    { text: 'Total', kinds: ['text'] },
  ],
  nl: [
    { text: 'Home', kinds: ['text'] },
    { text: 'Contact', kinds: ['text'] },
    { text: 'Webmaster', kinds: ['text', 'option'] },
    { text: 'Item', kinds: ['text'] },
    { text: 'Details', kinds: ['text'] },
    { text: 'Status', kinds: ['text'] },
  ],
};

/** Whether `language` legitimately shows this text as it is in English. */
export const isSharedWithEnglish = (language: Language, { kind, text }: UiText): boolean =>
  !!SAME_AS_ENGLISH[language]?.some((word) => word.text === text && word.kinds.includes(kind));

/**
 * Tokens that are not words of any language: the accepted file extension on the contact form,
 * the card security code's acronym, and the date format the registration form asks for (the API accepts only YYYY-MM-DD, so the
 * hint must not be localised).
 */
export const SAME_IN_EVERY_LANGUAGE = ['txt', 'YYYY-MM-DD', 'CVV'];

/** An invoice number the order confirmation names: an identifier the shop issues, not a word. */
export const REFERENCE_NUMBER = /^INV-\d+$/;

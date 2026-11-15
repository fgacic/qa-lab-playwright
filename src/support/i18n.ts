import type { Page } from '@playwright/test';
import type { Language } from '@components/LanguageSwitcher';

/**
 * Where on the page a string of UI text was read: the text itself, or an attribute assistive
 * technology or the browser shows (an input's placeholder, a button's aria-label, a tooltip).
 */
export type UiTextKind = 'text' | 'placeholder' | 'aria-label' | 'title' | 'alt' | 'value' | 'option';

export interface UiText {
  kind: UiTextKind;
  text: string;
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
  '[data-test="product-name"]', '[data-test="product-description"]', '[data-test="product-price"]', '[data-test="unit-price"]',
  '[data-test^="product-0"]', '[data-test="product-title"]', '[data-test="product-specs"]', '.card-title', 'figure',
  'label:has([data-test^="category-"])', 'label:has([data-test^="brand-"])', '[data-test="footer-explore"]',
  '.card-img-wrapper', '[data-test="country"]', 'app-footer a[href*="unsplash"]', 'footer .text-muted', '.testing-notification-bar', '.guide-container',
  'script', 'style',
];

/**
 * Containers whose text is not language (a slider's numbers, the language names, a label that
 * repeats a data value) but whose own attributes are still read: an `aria-label` on them is UI.
 */
const TEXT_ONLY = ['.ngx-slider', '[data-test="language-select"]', '[data-test^="lang-"]', '[aria-label="category"]', '[aria-label="brand"]'];

/**
 * Every string of UI a visitor can see or hear on the page, trimmed, one entry per distinct
 * string: text nodes, `placeholder`, `aria-label`, `title`, `alt`, the value of a submit or
 * button input, and the text of `<option>`s. Items of a dropdown menu are read although the menu
 * is closed (it is part of the page; its toggle must be visible). The shop's data (see DATA) is left out.
 */
export async function visibleUiText(page: Page): Promise<UiText[]> {
  return page.evaluate(
    ({ data, textOnly }) => {
      const out = new Map<string, { kind: UiTextKind; text: string }>();
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
        if (text.length < 2 || !/\p{L}/u.test(text) || inside(el, data) || !shown(el)) return;
        if (textOnlyToo && inside(el, textOnly)) return;
        out.set(`${kind}\u0000${text}`, { kind, text });
      };

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
    { data: DATA, textOnly: TEXT_ONLY },
  );
}

/**
 * Dotted translation keys that leaked into the page ("nav.home", "page.forgot-password.confirm"):
 * lowercase segments joined by dots and standing alone, so an email, a URL, a price, a version
 * or a filename inside a sentence is not one. Domain-like and abbreviation-like matches are dropped.
 */
const KEY = /(?<![\p{L}\p{N}@/.:_-])\p{Ll}[\p{Ll}\p{N}_-]*(?:\.\p{Ll}[\p{Ll}\p{N}_-]*)+(?![\p{L}\p{N}@/_-]|\.[\p{L}\p{N}])/gu;
// Abbreviations are letters in twos: e.g, i.e, d.h (German), π.χ (Greek "e.g.").
const NOT_KEYS = /^\p{L}{1,2}(?:\.\p{L}{1,2})+$|\.(?:com|dev|io|org|net|txt|png|jpg|pdf)$/u;

export function untranslatedKeys(texts: string[]): string[] {
  return texts.flatMap((t) => t.match(KEY) ?? []).filter((k) => !NOT_KEYS.test(k));
}

/** Makes the SPA start in a language, as a returning visitor who chose it would. */
export async function startInLanguage(page: Page, language: Language): Promise<void> {
  await page.addInitScript((lang) => localStorage.setItem('language', lang), language);
}

/**
 * Words a translation legitimately shares with English: "Contact" in French and Dutch,
 * "Home" in Dutch, "Message" in French, the loanword "Webmaster", "Name" in German.
 */
export const SAME_AS_ENGLISH: Partial<Record<Language, string[]>> = {
  de: ['Webmaster', 'Name (A - Z)', 'Name (Z - A)'],
  es: ['Webmaster'],
  fr: ['Contact', 'Message *', 'Webmaster'],
  nl: ['Home', 'Contact', 'Webmaster'],
};

/**
 * Tokens that are not words of any language: the accepted file extension on the contact form,
 * and the date format the registration form asks for (the API accepts only YYYY-MM-DD, so the
 * hint must not be localised).
 */
export const SAME_IN_EVERY_LANGUAGE = ['txt', 'YYYY-MM-DD'];

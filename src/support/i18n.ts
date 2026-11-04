import type { Page } from '@playwright/test';
import type { Language } from '@components/LanguageSwitcher';

/**
 * Text that is the same in every language by design, so it is not checked: the shop's data
 * (product, brand and category names, descriptions, specs, prices), names of people and
 * external products, the build line, and the training-aid bar laid over the shop for testers.
 * CSS, because these are containers with no role to find them by.
 */
const NOT_TRANSLATABLE = [
  '[data-test="product-name"]', '[data-test="product-description"]', '[data-test="product-price"]', '[data-test="unit-price"]',
  '[data-test^="product-0"]', '[data-test="product-title"]', '[data-test="product-specs"]', '.card-title', 'figure',
  'label:has([data-test^="category-"])', 'label:has([data-test^="brand-"])', '[aria-label="category"]', '[aria-label="brand"]', '[data-test="footer-explore"]',
  '.ngx-slider', 'option', '[data-test="nav-menu"]', '[data-test="language-select"]', 'app-footer a[href*="unsplash"]',
  'footer .text-muted', '.testing-notification-bar', '.guide-container', 'script', 'style',
];

/** Visible text nodes outside the data above, trimmed, one entry per distinct string. */
export async function visibleUiText(page: Page): Promise<string[]> {
  return page.evaluate((excluded) => {
    const out = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length < 2 || !/[A-Za-zÀ-ÿΑ-ωА-я]/.test(text)) continue;
      const element = node.parentElement;
      if (!element || excluded.some((s) => element.closest(s))) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || !element.getClientRects().length) continue;
      out.add(text);
    }
    return [...out];
  }, NOT_TRANSLATABLE);
}

/** Dotted translation keys that leaked into the page ("page.forgot-password.confirm"). */
export function untranslatedKeys(texts: string[]): string[] {
  return texts.flatMap((t) => t.match(/\b[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+){2,}\b/g) ?? []).filter((k) => !/\.(com|dev|io|org|net)\b/.test(k));
}

/** Makes the SPA start in a language, as a returning visitor who chose it would. */
export async function startInLanguage(page: Page, language: Language): Promise<void> {
  await page.addInitScript((lang) => localStorage.setItem('language', lang), language);
}

/**
 * Words a translation legitimately shares with English: "Contact" in French and Dutch,
 * "Home" in Dutch, "Message" in French.
 */
export const SAME_AS_ENGLISH: Partial<Record<Language, string[]>> = {
  fr: ['Contact', 'Message *'],
  nl: ['Home', 'Contact'],
};

/** Tokens that are not words of any language: the accepted file extension on the contact form. */
export const SAME_IN_EVERY_LANGUAGE = ['txt'];

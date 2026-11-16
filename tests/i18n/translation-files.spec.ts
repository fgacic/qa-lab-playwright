import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { apiOnlyTest as test, expect } from '@fixtures/index';
import type { APIRequestContext } from '@playwright/test';
import { knownBug } from '@support/known-bug';

/**
 * The seven translation files the SPA loads (`assets/i18n/<language>.json`), compared with each other: every language
 * must define the same keys. A key one file lacks shows as its raw name in that language, whichever page uses it, and the
 * page-by-page reads in completeness.spec.ts only see the keys the visited pages use.
 * @i18n: Chromium only, with the rest of the translation checks. No page is opened.
 */
type Json = { [key: string]: Json | string };

/** `a.b.c` for every string in the file. */
const keysOf = (node: Json, prefix = ''): string[] =>
  Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [`${prefix}${key}`] : keysOf(value, `${prefix}${key}.`)));

test.describe('Translation files hold the same keys', { tag: ['@i18n'] }, () => {
  /** What each language lacks and what it has that English does not, as the English file is the one the others are measured against. */
  const comparedWithEnglish = async (request: APIRequestContext) => {
    const files = new Map<Language, Set<string>>();
    for (const language of LANGUAGES) {
      const response = await request.get(`/assets/i18n/${language}.json`);
      expect(response.ok(), `${language}.json is served`).toBe(true);
      files.set(language, new Set(keysOf((await response.json()) as Json)));
    }
    const english = files.get('en')!;
    expect(english.size, 'the English file holds keys at all').toBeGreaterThan(100);
    return LANGUAGES.filter((language) => language !== 'en').flatMap((language) => {
      const other = files.get(language)!;
      return [
        ...[...english].filter((key) => !other.has(key)).map((key) => `${language} lacks ${key}`),
        ...[...other].filter((key) => !english.has(key)).map((key) => `${language} has ${key}, English does not`),
      ];
    });
  };

  test('I18N-27: every language defines the keys English does', { tag: ['@bug'] }, async ({ request }) => {
    knownBug('I18N-27', 'the English file lacks fields.address.label, .placeholder and .errors.required, which the six other files define');
    expect(await comparedWithEnglish(request), 'I18N-27: keys that differ between the translation files').toEqual([]);
  });
});

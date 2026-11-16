import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { apiOnlyTest as test, expect } from '@fixtures/index';
import type { APIRequestContext } from '@playwright/test';
import { knownBug } from '@support/known-bug';

/**
 * The seven translation files the SPA loads (`assets/i18n/<language>.json`), compared with each other: every language
 * must define the same keys, none may be empty, and each must keep the `{{placeholders}}` of the English value (a value
 * that drops one shows the sentence without the name or number it is about). A key one file lacks shows as its raw name in
 * that language, whichever page uses it, and the page-by-page reads in completeness.spec.ts only see the keys the visited pages use.
 * @i18n: Chromium only, with the rest of the translation checks. No page is opened.
 */
type Json = { [key: string]: Json | string };

/** `a.b.c` and its value, for every string in the file. */
const entriesOf = (node: Json, prefix = ''): [string, string][] =>
  Object.entries(node).flatMap(([key, value]) => (typeof value === 'string' ? [[`${prefix}${key}`, value] as [string, string]] : entriesOf(value, `${prefix}${key}.`)));

/** The names of the `{{ name }}` placeholders in a value, sorted, one entry per occurrence. */
const placeholdersOf = (value: string): string[] => [...value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map(([, name]) => name).sort();

test.describe('Translation files agree with English', { tag: ['@i18n'] }, () => {
  /** Every file as a map of key to value, the English one measured against by the others. */
  const filesOf = async (request: APIRequestContext) => {
    const files = new Map<Language, Map<string, string>>();
    for (const language of LANGUAGES) {
      const response = await request.get(`/assets/i18n/${language}.json`);
      expect(response.ok(), `${language}.json is served`).toBe(true);
      files.set(language, new Map(entriesOf((await response.json()) as Json)));
    }
    expect(files.get('en')!.size, 'the English file holds keys at all').toBeGreaterThan(100);
    return files;
  };
  const others = LANGUAGES.filter((language) => language !== 'en');

  /** What each language lacks and what it has that English does not, as the English file is the one the others are measured against. */
  const comparedWithEnglish = async (request: APIRequestContext) => {
    const files = await filesOf(request);
    const english = files.get('en')!;
    return others.flatMap((language) => {
      const other = files.get(language)!;
      return [
        ...[...english.keys()].filter((key) => !other.has(key)).map((key) => `${language} lacks ${key}`),
        ...[...other.keys()].filter((key) => !english.has(key)).map((key) => `${language} has ${key}, English does not`),
      ];
    });
  };

  test('I18N-27: every language defines the keys English does', { tag: ['@bug'] }, async ({ request }) => {
    knownBug('I18N-27', 'the English file lacks fields.address.label, .placeholder and .errors.required, which the six other files define');
    expect(await comparedWithEnglish(request), 'I18N-27: keys that differ between the translation files').toEqual([]);
  });

  test('no translation file holds an empty value', async ({ request }) => {
    const files = await filesOf(request);
    const empty = LANGUAGES.flatMap((language) => [...files.get(language)!].filter(([, value]) => value.trim() === '').map(([key]) => `${language} ${key}`));
    expect(empty, 'keys whose value is empty, so the page shows nothing where a word belongs').toEqual([]);
  });

  test('I18N-28: every language keeps the placeholders of the English value', { tag: ['@bug'] }, async ({ request }) => {
    knownBug('I18N-28', 'the Greek pages.comparison.remove-product is "Αφαίρεση προϊόντος": it drops the {{ name }} the English "Remove {{ name }} from comparison" fills in');
    const files = await filesOf(request);
    const english = files.get('en')!;
    // Only values both files define (a missing key is I18N-27's), and the English file must carry placeholders at all, or the comparison proves nothing.
    expect([...english.values()].filter((value) => placeholdersOf(value).length > 0).length, 'the English file holds values with placeholders').toBeGreaterThan(0);
    const differing = others.flatMap((language) =>
      [...files.get(language)!]
        .filter(([key, value]) => english.has(key) && placeholdersOf(value).join() !== placeholdersOf(english.get(key)!).join())
        .map(([key, value]) => `${language} ${key}: "${value}" has {${placeholdersOf(value)}}, English has {${placeholdersOf(english.get(key)!)}}`),
    );
    expect(differing, 'I18N-28: values whose placeholders differ from the English value').toEqual([]);
  });
});

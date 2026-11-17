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

/** The keys only the six other files define (I18N-27), and the one Greek value that drops a placeholder (I18N-28): the known differences. */
const I18N_27 = ['fields.address.label', 'fields.address.placeholder', 'fields.address.errors.required'];
const GREEK: Language = 'el';
const I18N_28 = ['pages.comparison.remove-product'];

test.describe('Translation files agree with English', { tag: ['@i18n'] }, () => {
  /** Every file as a map of key to value, the English one measured against by the others. */
  const loadFiles = async (request: APIRequestContext) => {
    const loaded = await Promise.all(
      LANGUAGES.map(async (language) => {
        const response = await request.get(`/assets/i18n/${language}.json`);
        expect(response.ok(), `${language}.json is served`).toBe(true);
        return [language, new Map(entriesOf((await response.json()) as Json))] as const;
      }),
    );
    const files = new Map<Language, Map<string, string>>(loaded);
    expect(files.get('en')!.size, 'the English file holds keys at all').toBeGreaterThan(100);
    return files;
  };
  // The files are static for the run, and each of the five tests below reads them: fetched once per worker (a plain map, no request
  // context kept), and dropped again if the fetch failed so the next test tries afresh.
  let loadedFiles: ReturnType<typeof loadFiles> | undefined;
  const filesOf = (request: APIRequestContext) => (loadedFiles ??= loadFiles(request).catch((error) => ((loadedFiles = undefined), Promise.reject(error))));
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

  /** Values whose placeholders differ from the English value, among the keys both files define (a missing key is I18N-27's). */
  const placeholderDiffs = async (request: APIRequestContext) => {
    const files = await filesOf(request);
    const english = files.get('en')!;
    // The English file must carry placeholders at all, or the comparison proves nothing.
    expect([...english.values()].filter((value) => placeholdersOf(value).length > 0).length, 'the English file holds values with placeholders').toBeGreaterThan(0);
    return others.flatMap((language) =>
      [...files.get(language)!]
        .filter(([key, value]) => english.has(key) && placeholdersOf(value).join() !== placeholdersOf(english.get(key)!).join())
        .map(([key, value]) => `${language} ${key}: "${value}" has {${placeholdersOf(value)}}, English has {${placeholdersOf(english.get(key)!)}}`),
    );
  };

  test('I18N-28: every language keeps the placeholders of the English value', { tag: ['@bug'] }, async ({ request }) => {
    knownBug('I18N-28', 'the Greek pages.comparison.remove-product is "Αφαίρεση προϊόντος": it drops the {{ name }} the English "Remove {{ name }} from comparison" fills in');
    expect(await placeholderDiffs(request), 'I18N-28: values whose placeholders differ from the English value').toEqual([]);
  });

  // The two pins above stay red for as long as their one known difference stands, and they would stay red just the same for a new one
  // in another language. These two read what the pins do not: every difference but the known ones, so new drift fails the gate now.
  test('no translation file drifts from English beyond the known I18N-27 and I18N-28 differences', async ({ request }) => {
    const unknownKeys = (await comparedWithEnglish(request)).filter((line) => !I18N_27.some((key) => others.some((language) => line === `${language} has ${key}, English does not`)));
    expect(unknownKeys, 'keys that differ between the translation files, apart from the three I18N-27 lists').toEqual([]);
    const unknownPlaceholders = (await placeholderDiffs(request)).filter((line) => !I18N_28.some((key) => line.startsWith(`${GREEK} ${key}: `)));
    expect(unknownPlaceholders, 'values whose placeholders differ from English, apart from the I18N-28 one').toEqual([]);
  });

  // The allow-list cannot go stale: once a known difference is fixed its pin goes green, and this says so, so the entry is taken out
  // of I18N_27 / I18N_28 and not left to excuse a later regression.
  test('the known I18N-27 and I18N-28 differences are all still there', async ({ request }) => {
    const keyDifferences = await comparedWithEnglish(request);
    expect(
      I18N_27.filter((key) => !keyDifferences.some((line) => others.some((language) => line === `${language} has ${key}, English does not`))),
      'I18N-27 keys that no file differs on any more: take them out of I18N_27',
    ).toEqual([]);
    const placeholderDifferences = await placeholderDiffs(request);
    expect(
      I18N_28.filter((key) => !placeholderDifferences.some((line) => line.startsWith(`${GREEK} ${key}: `))),
      'I18N-28 values whose placeholders agree now: take them out of I18N_28',
    ).toEqual([]);
  });
});

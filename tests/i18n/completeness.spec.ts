import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, test as base } from '@fixtures';
import { KNOWN, languagesOf } from '@support/i18n-baseline';
import { REFERENCE_NUMBER, SAME_IN_EVERY_LANGUAGE, describeUiText, isSharedWithEnglish, untranslatedKeys, type UiText } from '@support/i18n';
import { knownBug } from '@support/known-bug';
import { bothRenderings, readPage, arrange, sameKey, type Arrangement } from './read-visit';
import { VISITS, type Visit } from './visits';

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
const visitNamed = (name: string): Visit => {
  const visit = VISITS.find((v) => v.name === name);
  if (!visit) throw new Error(`No visit named "${name}"`);
  return visit;
};

/** The five fixtures every test below hands to `arrange`, as one: a test asks for `arrangement` and nothing else it does not use itself. */
const test = base.extend<{ arrangement: Arrangement }>({
  arrangement: async ({ context, consoleGuard, apiMock, catalog, api }, use) => use({ context, consoleGuard, apiMock, catalog, api }),
});

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

// About 29 visits x 7 languages x 1 or 2 checks is a few hundred browser tests from one loop: kept as separate tests on purpose, so a report row names one
// defect in one language. The cost was measured (Chromium, 2 workers, the machine busy with other suites, load about 16): the slowest, the checkout payment
// step in French (two renderings, the five-step wizard driven once in English), took 7.7 s against the 45 s timeout. A test that nears it is the signal to trim
// the arrangement (`driveInEnglish` already halves the checkout visits); nothing needs trimming while the slowest is a fraction of the limit.
test.describe('Translations are complete', { tag: ['@i18n'] }, () => {
  for (const visit of VISITS) {
    for (const language of LANGUAGES) {
      test(`${visit.name} in ${language}: no translation key leaks`, async ({ arrangement }) => {
        const scene = await arrange(visit, arrangement);
        // Read for keys: everything but the shop's real data, so the footer, the sliders and the shared wording are looked at too.
        const { texts } = await readPage(language, visit, scene, 'keys');
        expect(leakedKeys(texts, visit, language), `translation keys shown on ${visit.name} in ${language}`).toEqual([]);
      });

      if (language === 'en') continue;
      test(`${visit.name} in ${language}: no stray English`, async ({ arrangement }) => {
        const { english, texts } = await bothRenderings(language, visit, arrangement);

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

  // Coupled to the shape of the German file on purpose (header.menu, pages.comparison): a restructured file makes this control fail by name, which is the
  // right outcome, since a control that silently stopped spoiling anything would let the two checks above go blind.
  test('a key missing from the German file is a leak, and a value left in English is stray English', async ({ arrangement, request }) => {
    const home = visitNamed('home');
    const english = (await (await request.get('/assets/i18n/en.json')).json()) as Record<string, unknown>;
    await arrangement.context.route('**/assets/i18n/de.json', async (route) => {
      const response = await route.fetch();
      const file = (await response.json()) as Record<string, unknown>;
      const menu = (file.header as { menu: Record<string, string> }).menu;
      delete menu.home;
      delete (file.pages as { comparison: Record<string, string> }).comparison.add;
      menu.contact = (english.header as { menu: Record<string, string> }).menu.contact;
      await route.fulfill({ response, json: file });
    });

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
      test(`${known.id}: ${known.title} is translated in ${language}`, async ({ arrangement }) => {
        knownBug(known.id, known.summary);
        const visit = visitNamed(known.visit);
        const { english, texts } = await bothRenderings(language, visit, arrangement);

        // Identical to the English rendering: a fixed site shows nothing here, and so does a renamed string.
        const stillEnglish = texts
          .filter((t) => english.has(sameKey(t)) && (!known.pageOnly || t.part === 'page') && (known.kinds ?? ['text']).includes(t.kind) && known.text.test(t.text))
          .map(describeUiText);

        expect(stillEnglish, `${known.id}: ${known.title} is still English in ${language}`).toEqual([]);
      });
    }
  }
});

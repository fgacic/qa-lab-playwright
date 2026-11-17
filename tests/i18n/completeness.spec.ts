import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, mock, test as base } from '@fixtures';
import type { Catalog } from '@fixtures/api';
import type { ConsoleGuard } from '@fixtures/console-guard';
import type { BrowserContext, Page } from '@playwright/test';
import type { ApiMock } from '@support/api-mock';
import { skipIfBotChallenge } from '@support/bot-challenge';
import { freezeClock } from '@support/clock';
import { KNOWN, languagesOf } from '@support/i18n-baseline';
import {
  REFERENCE_NUMBER,
  SAME_IN_EVERY_LANGUAGE,
  describeUiText,
  isSharedWithEnglish,
  settledUiText,
  startInLanguage,
  untranslatedKeys,
  watchDataTraffic,
  type ReadFor,
  type UiText,
} from '@support/i18n';
import { knownBug } from '@support/known-bug';
import { fakeJwt, fakeUser } from '@support/payloads';
import { installToken } from '@support/session';
import type { ToolshopApi } from '@support/toolshop-api';
import { CATEGORIES_MENU, PHONE, VISITS, type Visit } from './visits';

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

interface Arrangement {
  context: BrowserContext;
  consoleGuard: ConsoleGuard;
  apiMock: ApiMock;
  catalog: Catalog;
  api: ToolshopApi;
}

/** The five fixtures every test below hands to `arrange`, as one: a test asks for `arrangement` and nothing else it does not use itself. */
const test = base.extend<{ arrangement: Arrangement }>({
  arrangement: async ({ context, consoleGuard, apiMock, catalog, api }, use) => use({ context, consoleGuard, apiMock, catalog, api }),
});

/** What a visit needs, done once: the path to open and a way to open it in a fresh tab. */
interface Scene {
  path: string;
  /** A new tab as a returning visitor who chose `language` would open it, with the visit's session, comparison and cart in place. */
  open: (language: Language) => Promise<Page>;
}

/**
 * What the visit needs before its page opens: the answers, the session, the comparison and the
 * cart. Done once per test, whatever the number of renderings; each rendering then opens its own
 * tab, so nothing a rendering stored or scripted reaches the next.
 */
async function arrange(visit: Visit, { context, consoleGuard, apiMock, catalog, api }: Arrangement): Promise<Scene> {
  const token = fakeJwt();
  // The clock belongs to the context, so every tab of the visit has it from its first script on: it runs as usual until `freezeClock`.
  if (visit.fades) await context.clock.install();
  if (visit.logs) consoleGuard.allow(visit.logs.pattern, visit.logs.reason);
  if (visit.refused) consoleGuard.allowStatus(visit.refused.status, visit.refused.path, visit.refused.reason);
  if (visit.signedIn) await apiMock.use(mock.respond('GET', '/users/me', fakeUser));
  if (visit.mocks) await apiMock.use(...(typeof visit.mocks === 'function' ? await visit.mocks(catalog) : visit.mocks));
  const ids = visit.compared ? [(await catalog.inStock()).id, (await catalog.outOfStock()).id] : undefined;
  // A tab holds one cart: made through the API, then put in each tab's session storage once (the order consumes it).
  const cartId = visit.cart ? await api.createCart([{ product: await catalog.inStock(), quantity: 1 }]) : undefined;
  const path = typeof visit.path === 'string' ? visit.path : await visit.path(catalog);
  return {
    path,
    open: async (language) => {
      const page = await context.newPage();
      if (visit.phone) await page.setViewportSize(PHONE);
      await startInLanguage(page, language);
      if (visit.signedIn) await installToken(page, token);
      if (ids) await page.addInitScript((ids) => sessionStorage.setItem('compare_ids', JSON.stringify(ids)), ids);
      if (cartId) {
        await page.addInitScript((cartId) => {
          if (sessionStorage.getItem('qa-lab-cart-seeded')) return;
          sessionStorage.setItem('qa-lab-cart-seeded', '1');
          sessionStorage.setItem('cart_id', cartId);
          sessionStorage.setItem('cart_quantity', '1');
        }, cartId);
      }
      return page;
    },
  };
}

/** Opens the visit's page in `startsIn` and takes it to the state the visit is about: loaded, its content drawn, its form submitted, its steps run. */
async function reachVisitState(page: Page, visit: Visit, path: string, startsIn: Language): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await skipIfBotChallenge(page);
  await expect(page.locator('html')).toHaveAttribute('lang', startsIn);
  for (const content of visit.ready(page)) await expect(content.first()).toBeVisible();
  if (visit.submit) {
    await page.getByTestId(visit.submit.button).click();
    await expect(page.getByTestId(visit.submit.error).first()).toBeVisible();
  }
  await visit.drive?.(page);
  await visit.witness?.(page);
  // The toast is drawn: stop its timer, so the settled reads of the caller see it however long they take.
  if (visit.fades) await freezeClock(page);
}

/** Chooses `language` in the header's language menu, as a visitor does, and waits for the page to say it applied. */
async function switchLanguage(page: Page, language: Language): Promise<void> {
  await page.getByTestId('language-select').click();
  await page.getByTestId(`lang-${language}`).click();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

/**
 * The UI text of the page as a returning visitor who chose `language` sees it, once its own
 * content is there, the language is applied and the text has stopped changing. A visit whose steps
 * run in English (`driveInEnglish`) also reads the English text just before it switches, as `english`:
 * the same page in both languages, which a visit that cannot be repeated (an order consumes the cart) needs.
 * The tab is closed when the read is done.
 */
async function readPage(language: Language, visit: Visit, scene: Scene, readFor: ReadFor): Promise<{ texts: UiText[]; english?: UiText[] }> {
  // The steps of a visit that runs in English start there, and the language menu switches afterwards.
  const startsIn = visit.driveInEnglish ? 'en' : language;
  const page = await scene.open(startsIn);
  // Watched from before the navigation, so the settled read knows when the page's own requests are answered.
  const traffic = watchDataTraffic(page);
  try {
    await reachVisitState(page, visit, scene.path, startsIn);
    // The state must still be drawn when the sample is in, not only when the steps ended: before and after the read bracket it.
    const sample = async () => {
      const read = await settledUiText(page, traffic, readFor);
      await visit.witness?.(page);
      return read;
    };
    let english: UiText[] | undefined;
    if (startsIn !== language) {
      await expect(page.getByTestId('nav-categories')).toHaveText(CATEGORIES_MENU.en);
      english = await sample();
      expectPageText(english, visit, 'en');
      await switchLanguage(page, language);
    }
    // Language-specific evidence that the translation file is applied, not only that the page has rendered.
    await expect(page.getByTestId('nav-categories')).toHaveText(CATEGORIES_MENU[language]);
    const texts = await sample();
    expectPageText(texts, visit, language);
    return { texts, english };
  } finally {
    traffic.stop();
    // A frozen clock would freeze the next tab of the visit as well: its page would never finish loading.
    if (visit.fades) await page.clock.resume();
    await page.close();
  }
}

/**
 * A read that found little of the route's own would find few defects in it: if the shell is nearly all there was,
 * the page's content was missed (or is all data), and the checks below would pass for the wrong reason.
 * Each visit says how many strings of its own it must show (`pageStrings`).
 */
function expectPageText(texts: UiText[], visit: Visit, language: Language): void {
  expect(
    texts.filter((t) => t.part === 'page').length,
    `${visit.name} in ${language}: strings of the route itself (not the header and footer) read, at least ${visit.pageStrings}`,
  ).toBeGreaterThanOrEqual(visit.pageStrings);
}

/** The same visit in English and in `language`: one page, English first, unless the visit's steps run in English and give both. */
async function bothRenderings(language: Language, visit: Visit, arrangement: Arrangement): Promise<{ english: Set<string>; texts: UiText[] }> {
  const scene = await arrange(visit, arrangement);
  if (visit.driveInEnglish) {
    const { texts, english } = await readPage(language, visit, scene, 'strays');
    return { english: new Set(english!.map(sameKey)), texts };
  }
  const english = new Set((await readPage('en', visit, scene, 'strays')).texts.map(sameKey));
  return { english, texts: (await readPage(language, visit, scene, 'strays')).texts };
}

const sameKey = (t: UiText) => `${t.kind}\u0000${t.text}`;
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

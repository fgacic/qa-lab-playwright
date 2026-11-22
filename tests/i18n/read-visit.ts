import type { Language } from '@components/LanguageSwitcher';
import { AppShell } from '@pages/AppShell';
import { expect, mock } from '@fixtures';
import type { Catalog } from '@fixtures/api';
import type { ConsoleGuard } from '@fixtures/console-guard';
import type { BrowserContext, Page } from '@playwright/test';
import type { ApiMock } from '@support/api-mock';
import { skipIfBotChallenge } from '@support/bot-challenge';
import { freezeClock } from '@support/clock';
import { settledUiText, startInLanguage, watchDataTraffic, type ReadFor, type UiText } from '@support/i18n';
import { fakeJwt, fakeUser } from '@support/payloads';
import { installToken, seedTabCart, seedTabComparison } from '@support/session';
import type { ToolshopApi } from '@support/toolshop-api';
import { CATEGORIES_MENU, PHONE, type Visit } from './visits';

/** How a visit is set up and read for completeness.spec.ts: the answers, the session, the tab, the steps and the settled read. Not a spec, so it declares no test. */

export interface Arrangement {
  context: BrowserContext;
  consoleGuard: ConsoleGuard;
  apiMock: ApiMock;
  catalog: Catalog;
  api: ToolshopApi;
}

/** What a visit needs, done once: the path to open and a way to open it in a fresh tab. */
export interface Scene {
  path: string;
  /** A new tab as a returning visitor who chose `language` would open it, with the visit's session, comparison and cart in place. */
  open: (language: Language) => Promise<Page>;
}

/**
 * What the visit needs before its page opens: the answers, the session, the comparison and the
 * cart. Done once per test, whatever the number of renderings; each rendering then opens its own
 * tab, so nothing a rendering stored or scripted reaches the next.
 */
export async function arrange(visit: Visit, { context, consoleGuard, apiMock, catalog, api }: Arrangement): Promise<Scene> {
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
      if (ids) await seedTabComparison(page, ids);
      if (cartId) await seedTabCart(page, cartId, 1);
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
  await new AppShell(page).header.language.switchTo(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

/**
 * The UI text of the page as a returning visitor who chose `language` sees it, once its own
 * content is there, the language is applied and the text has stopped changing. A visit whose steps
 * run in English (`driveInEnglish`) also reads the English text just before it switches, as `english`:
 * the same page in both languages, which a visit that cannot be repeated (an order consumes the cart) needs.
 * The tab is closed when the read is done.
 */
export async function readPage(language: Language, visit: Visit, scene: Scene, readFor: ReadFor): Promise<{ texts: UiText[]; english?: UiText[] }> {
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
      await expect(new AppShell(page).header.navItem('categories')).toHaveText(CATEGORIES_MENU.en);
      english = await sample();
      expectPageText(english, visit, 'en');
      await switchLanguage(page, language);
    }
    // Language-specific evidence that the translation file is applied, not only that the page has rendered.
    await expect(new AppShell(page).header.navItem('categories')).toHaveText(CATEGORIES_MENU[language]);
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
export async function bothRenderings(language: Language, visit: Visit, arrangement: Arrangement): Promise<{ english: Set<string>; texts: UiText[] }> {
  const scene = await arrange(visit, arrangement);
  if (visit.driveInEnglish) {
    const { texts, english } = await readPage(language, visit, scene, 'strays');
    return { english: new Set(english!.map(sameKey)), texts };
  }
  const english = new Set((await readPage('en', visit, scene, 'strays')).texts.map(sameKey));
  return { english, texts: (await readPage(language, visit, scene, 'strays')).texts };
}

export const sameKey = (t: UiText) => `${t.kind}\u0000${t.text}`;

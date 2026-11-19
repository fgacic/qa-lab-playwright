import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import type { NavKey } from '@components/Header';
import { expect, test } from '@fixtures';
import { BASE_URL } from '@support/env';

/**
 * What the header says in each language (as shipped on the site, typos included). Dutch "Home" and
 * Dutch and French "Contact" equal the English word: those languages use it as is, so they are not
 * untranslated strings.
 */
const LABELLED_KEYS = ['home', 'categories', 'contact', 'sign-in'] as const satisfies readonly NavKey[];
type NavLabels = Record<(typeof LABELLED_KEYS)[number], string>;
const NAV_LABELS: Record<Language, NavLabels> = {
  de: { home: 'Start', categories: 'Kategorien', contact: 'Kontakt', 'sign-in': 'Einloggen' },
  el: { home: 'Αρχική', categories: 'Κατηγορίες', contact: 'Επικοινωνία', 'sign-in': 'Σύνδεση' },
  en: { home: 'Home', categories: 'Categories', contact: 'Contact', 'sign-in': 'Sign in' },
  es: { home: 'Inicio', categories: 'Categorías', contact: 'Contacto', 'sign-in': 'Iniciar sesión' },
  fr: { home: 'Accueil', categories: 'Catégories', contact: 'Contact', 'sign-in': 'Se connecter' },
  nl: { home: 'Home', categories: 'Categorieën', contact: 'Contact', 'sign-in': 'Inloggen' },
  tr: { home: 'Anasayfa', categories: 'Kategoriler', contact: 'İletişim', 'sign-in': 'Giriş Yap' },
};

test.describe('Language switcher', () => {
  test('offers the seven supported languages', async ({ homePage }) => {
    const { language } = homePage.header;
    await language.button.click();

    // The count is literal on purpose: a language dropped from LANGUAGES must fail here, not shrink the expectation with it.
    await expect(language.menu.getByRole('menuitem')).toHaveCount(7);
    await expect(language.menu.getByRole('menuitem')).toHaveText(LANGUAGES.map((l) => l.toUpperCase()));
  });

  // Every case starts from a language other than the target, so each switch is a real change.
  for (const lang of LANGUAGES) {
    const from: Language = lang === 'en' ? 'de' : 'en';
    test(`switching from ${from.toUpperCase()} to ${lang.toUpperCase()} translates the header`, async ({ homePage, page }) => {
      const { header } = homePage;
      await header.language.switchTo(from);
      await expect(header.navItem('home')).toHaveText(NAV_LABELS[from].home);

      await header.language.switchTo(lang);

      await expect(header.language.button).toHaveText(lang.toUpperCase());
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      for (const key of LABELLED_KEYS) {
        await expect.soft(header.navItem(key), key).toHaveText(NAV_LABELS[lang][key]);
      }
    });
  }

  test('the chosen language survives a reload and a route change', async ({ homePage, page }) => {
    const { header } = homePage;
    await header.language.switchTo('de');
    await expect(header.navItem('home')).toHaveText(NAV_LABELS.de.home);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    await homePage.shell.reload();
    await expect(header.navItem('home')).toHaveText(NAV_LABELS.de.home);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await header.navItem('contact').click();

    await expect(page).toHaveURL('/contact');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(header.navItem('home')).toHaveText(NAV_LABELS.de.home);
    await expect(page.getByRole('heading', { name: NAV_LABELS.de.contact, exact: true })).toBeVisible();
  });

  // What a visitor's browser may hold under "language": a value the shop does not offer (a language it dropped, another case, an
  // empty string, JSON from another app). The shop must open in English, its default, not in a half-translated page.
  const storedLanguage = (value: string) => ({ storageState: { cookies: [], origins: [{ origin: new URL(BASE_URL).origin, localStorage: [{ name: 'language', value }] }] } });
  // The control: the same seeding with a language the shop offers is used, so the English below is a fallback and not the seeding being ignored.
  test.describe('with a supported language stored as the language', () => {
    test.use(storedLanguage('fr'));

    test('the shop opens in that language', async ({ homePage, page }) => {
      await expect(homePage.header.language.button).toHaveText('FR');
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(homePage.header.navItem('home')).toHaveText(NAV_LABELS.fr.home);
    });
  });

  const unsupported: [string, string][] = [['a language the shop does not offer', 'xx'], ['an upper-case code', 'DE'], ['an empty value', ''], ['JSON', '{"language":"de"}']];
  for (const [what, stored] of unsupported) {
    test.describe(`with ${what} stored as the language`, () => {
      test.use(storedLanguage(stored));

      test('the shop opens in English', async ({ homePage, page }) => {
        await expect(homePage.header.language.button).toHaveText('EN');
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        for (const key of LABELLED_KEYS) {
          await expect.soft(homePage.header.navItem(key), key).toHaveText(NAV_LABELS.en[key]);
        }
      });
    });
  }
});

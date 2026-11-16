import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import type { NavKey } from '@components/Header';
import { expect, test } from '@fixtures';

/**
 * What the header says in each language (as shipped on the site, typos included). Dutch "Home" and
 * Dutch and French "Contact" equal the English word: those languages use it as is, so they are not
 * untranslated strings.
 */
type NavLabels = { home: string } & Partial<Record<NavKey, string>>;
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
      for (const [key, label] of Object.entries(NAV_LABELS[lang])) {
        await expect(header.navItem(key as NavKey)).toHaveText(label);
      }
    });
  }

  test('the chosen language survives a reload and a route change', async ({ homePage, page }) => {
    const { header } = homePage;
    await header.language.switchTo('de');
    await expect(header.navItem('home')).toHaveText('Start');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');

    await homePage.shell.reload();
    await expect(header.navItem('home')).toHaveText('Start');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await header.navItem('contact').click();

    await expect(page).toHaveURL('/contact');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(header.navItem('home')).toHaveText('Start');
    await expect(page.getByRole('heading', { name: 'Kontakt', exact: true })).toBeVisible();
  });
});

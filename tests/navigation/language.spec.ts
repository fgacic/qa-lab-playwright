import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import type { NavKey } from '@components/Header';
import { expect, test } from '@fixtures';
import { skipIfBotChallenge } from '@support/bot-challenge';

/** What the header says in each language (as shipped on the site, typos included). */
const NAV_LABELS: Record<Language, Partial<Record<NavKey, string>>> = {
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

  for (const lang of LANGUAGES) {
    test(`switching to ${lang.toUpperCase()} translates the header`, async ({ homePage, page }) => {
      const { header } = homePage;
      // Start from a non-English language so switching to EN is a real change too.
      if (lang === 'en') await header.language.switchTo('de');

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

    await page.reload({ waitUntil: 'domcontentloaded' });
    await skipIfBotChallenge(page);
    await header.navItem('contact').click();

    await expect(page).toHaveURL('/contact');
    await expect(header.navItem('home')).toHaveText('Start');
    await expect(page.getByRole('heading', { name: 'Kontakt' })).toBeVisible();
  });
});

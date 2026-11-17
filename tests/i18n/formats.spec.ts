import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, mock, test } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeInvoice, INVOICE_NUMBER, listOf } from '@support/payloads';

/**
 * How the shop writes numbers and dates in each language: the amounts of an order, and the date it was placed. The text checks of
 * completeness.spec.ts read words, so a price that stays "$1234.50" in every language, or a date left as the database wrote it,
 * passes them. The expected strings are a fixed table (CLDR's, as `Intl` writes them today): a browser or ICU upgrade must not move what the
 * spec expects, and a figure that changed on its own would be a decision to take, not a drift to absorb. Only the order's figures are
 * read here: the prices of a card or the cart are another surface, recorded in docs/COVERAGE.md.
 * One invoice with a fixed total and date, mocked, so the figures do not follow the seed; the language is chosen in the header, as a visitor does.
 * Every language here is left to right, so no layout in the other direction is asked for.
 * @i18n: Chromium only, with the rest of the translation checks.
 */
const TOTAL = 1234.5;
/** The database timestamp the invoice carries, as the shop's API writes it. */
const INVOICE_DATE = '2026-11-01 10:00:00';
/** The shop's currency sign, which no language changes (I18N-29 is about where the separators go). */
const CURRENCY = '$';
/** Spaces (the thin and no-break ones some languages group with) made plain, in the text read and in the figure expected. */
const plain = (text: string) => text.replace(/\s/g, ' ');
const RAW_TIMESTAMP = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

/**
 * 1234.5 as a reader of each language writes it: points or commas, grouped or not (Spanish leaves four digits ungrouped), and French
 * groups with a narrow no-break space (U+202F), made plain by `plain` below like any other space.
 */
const FIGURES: Record<Language, string> = { de: '1.234,50', el: '1.234,50', en: '1,234.50', es: '1234,50', fr: '1 234,50', nl: '1.234,50', tr: '1.234,50' };
const figure = (language: Language) => plain(FIGURES[language]);

test.describe('Numbers and dates follow the language', { tag: ['@i18n', '@mocked'] }, () => {
  test.use({
    apiMocks: async ({ catalog }, use) => {
      const invoice = { ...fakeInvoice(await catalog.inStock()), invoice_date: INVOICE_DATE, subtotal: TOTAL, total: TOTAL };
      await use({ routes: [mock.respond('GET', '/invoices', listOf([invoice]))] });
    },
  });

  // Guards the guard: if two languages wrote the figure alike, the pins below could not tell a formatted amount from an unformatted one.
  test('the languages write the same amount in more than one way', () => {
    const written = new Set(LANGUAGES.map(figure));
    expect(written.size, `the ways the seven languages write ${TOTAL}: ${[...written].join(' | ')}`).toBeGreaterThan(2);
    expect(Object.keys(FIGURES).sort(), 'the table holds every language the shop offers').toEqual([...LANGUAGES]);
      });

  for (const language of LANGUAGES) {
    test(`I18N-29: the total of an order is written as a reader of ${language} writes it`, { tag: ['@bug'] }, async ({ invoicesPage }) => {
      knownBug('I18N-29', 'amounts are written "$1234.50" in every language: no thousands separator, and the point where German, Greek, Spanish, French, Dutch and Turkish write a comma');
      await invoicesPage.shell.header.language.switchTo(language);
      await expect(invoicesPage.page.locator('html')).toHaveAttribute('lang', language);
      const row = invoicesPage.invoice(INVOICE_NUMBER);
      await expect(row).toContainText(CURRENCY);

      await expect.poll(async () => plain(await row.innerText()), { message: `I18N-29: the row of the order holds ${figure(language)}`, timeout: BUG_TIMEOUT }).toContain(figure(language));
    });
  }

  for (const language of LANGUAGES) {
    // Per language, as the amounts are: the date a reader expects differs between them (day first, month first, year first).
    test(`I18N-30: the date of an order is not the database timestamp, in ${language}`, { tag: ['@bug'] }, async ({ invoicesPage }) => {
      knownBug('I18N-30', 'the order date is shown as the database wrote it ("2026-11-01 10:00:00"), with the seconds and no regard for the language');
      const row = invoicesPage.invoice(INVOICE_NUMBER);
      await invoicesPage.shell.header.language.switchTo(language);
      await expect(invoicesPage.page.locator('html')).toHaveAttribute('lang', language);
      await expect(row).toContainText('2026');

      await expect(row, `I18N-30: the row shows a date, not the raw timestamp, in ${language}`).not.toContainText(RAW_TIMESTAMP, { timeout: BUG_TIMEOUT });
    });
  }
});

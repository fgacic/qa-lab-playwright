import { LANGUAGES, type Language } from '@components/LanguageSwitcher';
import { expect, mock, test } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeInvoice, INVOICE_NUMBER, listOf } from '@support/payloads';

/**
 * How the shop writes numbers and dates in each language: the amounts of an order, and the date it was placed. The text checks of
 * completeness.spec.ts read words, so a price that stays "$1234.50" in every language, or a date left as the database wrote it,
 * passes them. The expected format is the browser's own for that language (`Intl`), so the spec carries no table of separators of its own.
 * One invoice with a fixed total and date, mocked, so the figures do not follow the seed; the language is chosen in the header, as a visitor does.
 * Every language here is left to right, so no layout in the other direction is asked for.
 * @i18n: Chromium only, with the rest of the translation checks.
 */
const TOTAL = 1234.5;
/** The database timestamp the invoice carries, as the shop's API writes it. */
const INVOICE_DATE = '2026-11-01 10:00:00';
/** The shop's currency sign, which no language changes (I18N-29 is about where the separators go). */
const CURRENCY = '$';
const RAW_TIMESTAMP = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

/** The figure as a reader of `language` writes it, spaces (the thin and no-break ones some languages group with) made plain. */
const figure = (language: Language) => new Intl.NumberFormat(language, { minimumFractionDigits: 2 }).format(TOTAL).replace(/\s/g, ' ');
const plain = (text: string) => text.replace(/\s/g, ' ');

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
    expect(figure('en'), 'English groups the thousands and marks the decimals with a point').toBe('1,234.50');
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

  test('I18N-30: the date of an order is not the database timestamp', { tag: ['@bug'] }, async ({ invoicesPage }) => {
    knownBug('I18N-30', 'the order date is shown as the database wrote it ("2026-11-01 10:00:00"), with the seconds and no regard for the language');
    const row = invoicesPage.invoice(INVOICE_NUMBER);

    // Every language, as the amounts are: the date a reader expects differs between them (day first, month first, year first).
    for (const language of LANGUAGES) {
      await invoicesPage.shell.header.language.switchTo(language);
      await expect(invoicesPage.page.locator('html')).toHaveAttribute('lang', language);
      await expect(row).toContainText('2026');

      await expect.soft(row, `I18N-30: the row shows a date, not the raw timestamp, in ${language}`).not.toContainText(RAW_TIMESTAMP, { timeout: BUG_TIMEOUT });
    }
  });
});

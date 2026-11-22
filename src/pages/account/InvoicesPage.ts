import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export class InvoicesPage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly table: Locator;
  readonly invoiceRows: Locator;
  /** The first column's header: drawn even when the list is empty. */
  readonly invoiceNumberHeader: Locator;
  /** What an account with no invoices should say, as the favorites and messages pages do (BUG-48: this page says nothing). */
  readonly emptyState: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByTestId('page-title');
    this.table = page.getByRole('table');
    this.invoiceNumberHeader = this.table.getByRole('columnheader', { name: 'Invoice Number' });
    this.emptyState = page.getByText(/no invoices|no orders/i);
    this.invoiceRows = this.table.getByRole('row').filter({ hasText: /INV-\d+/ });
  }

  invoice(invoiceNumber: string): Locator {
    return this.invoiceRows.filter({ hasText: invoiceNumber });
  }

  @step('Open my invoices')
  async open(): Promise<void> {
    await this.shell.goto('/account/invoices');
  }

  @step('Open the details of invoice {0}')
  async openDetails(invoiceNumber: string): Promise<InvoiceDetailsPage> {
    await this.invoice(invoiceNumber).getByRole('link', { name: 'Details' }).click();
    return new InvoiceDetailsPage(this.page);
  }
}

export class InvoiceDetailsPage {
  readonly downloadPdfButton: Locator;
  readonly table: Locator;
  readonly productLines: Locator;

  constructor(readonly page: Page) {
    this.downloadPdfButton = page.getByRole('button', { name: 'Download PDF' });
    this.table = page.getByRole('table').last();
    this.productLines = this.table.getByRole('row').filter({ has: page.getByRole('cell') });
  }

  /**
   * The quantity cell of a product's line, found by the "Quantity" column header rather than by position: the first cell
   * is the quantity today, and a reordered table must not make a spec read the price instead. Resolves once the header is drawn.
   * It is `async` on purpose: the column index comes from reading the header texts, which no locator expresses, so it cannot be a plain locator getter.
   */
  async quantityOf(productName: string): Promise<Locator> {
    const quantityHeader = this.table.getByRole('columnheader', { name: 'Quantity', exact: true });
    await quantityHeader.waitFor();
    const headers = await this.table.getByRole('columnheader').allInnerTexts();
    const column = headers.findIndex((header) => header.trim() === 'Quantity');
    return this.productLines.filter({ hasText: productName }).getByRole('cell').nth(column);
  }
}

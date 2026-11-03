import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export class InvoicesPage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly table: Locator;
  readonly invoiceRows: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByTestId('page-title');
    this.table = page.getByRole('table');
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
  readonly productLines: Locator;

  constructor(readonly page: Page) {
    this.downloadPdfButton = page.getByRole('button', { name: 'Download PDF' });
    this.productLines = page.getByRole('table').last().getByRole('row').filter({ has: page.getByRole('cell') });
  }

  field(label: string): Locator {
    return this.page.getByLabel(label, { exact: true });
  }
}

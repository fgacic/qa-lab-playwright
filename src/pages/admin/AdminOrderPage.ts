import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { ADMIN_MESSAGES, reportedFailure } from './alerts';

export const ORDER_STATUSES = ['AWAITING_FULFILLMENT', 'ON_HOLD', 'AWAITING_SHIPMENT', 'SHIPPED', 'COMPLETED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** /admin/orders/edit/{id}: read-only invoice details plus a status that can be changed. */
export class AdminOrderPage {
  readonly invoiceNumber: Locator;
  readonly total: Locator;
  readonly status: Locator;
  readonly statusMessage: Locator;
  readonly updateStatusButton: Locator;
  readonly paymentMethod: Locator;
  readonly billingCity: Locator;
  readonly lines: Locator;
  /** What the page says after a status change: the "Status updated!" confirmation (plain text, no role) or an error alert. */
  readonly feedback: Locator;
  /** The page's answer to an invoice that could not be loaded. */
  readonly notFoundNotice: Locator;
  /** Drawn in every state of the page, whatever the invoice request answered: what a test anchors on before it looks for an absence. */
  readonly backLink: Locator;
  /** What the page says when a request fails, in whatever form (an alert, or the site's plain error text). */
  readonly failure: Locator;

  constructor(readonly page: Page) {
    // exact: the date field's accessible name is "Invoice Number Invoice Date" (two labels).
    this.invoiceNumber = page.getByRole('textbox', { name: 'Invoice number', exact: true });
    // exact: "Subtotal" is a field of the same page.
    this.total = page.getByRole('textbox', { name: 'Total', exact: true });
    this.status = page.getByRole('combobox', { name: 'Status' });
    this.statusMessage = page.getByTestId('status-message');
    this.updateStatusButton = page.getByRole('button', { name: 'Update status' });
    this.paymentMethod = page.getByRole('textbox', { name: 'Payment Method' });
    this.billingCity = page.getByRole('textbox', { name: 'City', exact: true });
    this.lines = page.getByRole('table').getByRole('row').filter({ has: page.getByRole('cell') });
    this.feedback = page.getByRole('alert').or(page.getByText(ADMIN_MESSAGES.statusUpdated));
    this.notFoundNotice = page.getByText(ADMIN_MESSAGES.invoiceMissing);
    this.backLink = page.getByRole('link', { name: 'Back' });
    this.failure = reportedFailure(page);
  }

  /** The cells of an order line, in column order: quantity, product, unit price, line total. */
  lineCells(index = 0): Locator {
    return this.lines.nth(index).getByRole('cell');
  }

  @step('Set the order status to {0}')
  async updateStatus(status: OrderStatus): Promise<void> {
    await this.status.selectOption(status);
    await this.updateStatusButton.click();
  }
}

import type { Locator, Page } from '@playwright/test';
import { AdminTable } from '@components/admin/AdminTable';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export class AdminDashboardPage {
  readonly shell: AppShell;
  readonly salesHeading: Locator;
  readonly salesChart: Locator;
  readonly latestOrders: AdminTable;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.salesHeading = page.getByRole('heading', { name: 'Sales over the years' });
    // A <canvas> chart: no role or name to reach it by, and nothing inside it to read.
    this.salesChart = page.locator('canvas');
    this.latestOrders = new AdminTable(page.getByRole('table'));
  }

  @step('Open the admin dashboard')
  async open(): Promise<void> {
    await this.shell.goto('/admin/dashboard');
  }
}

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
  readonly feedback: Locator;

  constructor(readonly page: Page) {
    // exact: the date field's accessible name is "Invoice Number Invoice Date" (two labels).
    this.invoiceNumber = page.getByRole('textbox', { name: 'Invoice number', exact: true });
    this.total = page.getByRole('textbox', { name: 'Total' });
    this.status = page.getByRole('combobox', { name: 'Status' });
    this.statusMessage = page.getByTestId('status-message');
    this.updateStatusButton = page.getByRole('button', { name: 'Update status' });
    this.paymentMethod = page.getByRole('textbox', { name: 'Payment Method' });
    this.billingCity = page.getByRole('textbox', { name: 'City' });
    this.lines = page.getByRole('table').getByRole('row').filter({ has: page.getByRole('cell') });
    this.feedback = page.getByRole('alert').or(page.getByText('Status updated!'));
  }

  @step('Set the order status to {0}')
  async updateStatus(status: OrderStatus): Promise<void> {
    await this.status.selectOption(status);
    await this.updateStatusButton.click();
  }
}

export const MESSAGE_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const;

/** /admin/messages/{id}: the message, a status picker (saved on change) and a reply box. */
export class AdminMessagePage {
  readonly status: Locator;
  readonly replyBox: Locator;
  readonly replyButton: Locator;
  readonly backLink: Locator;

  constructor(readonly page: Page) {
    this.status = page.getByRole('combobox', { name: 'Status' });
    this.replyBox = page.getByRole('textbox', { name: 'Reply message' });
    this.replyButton = page.getByRole('button', { name: 'Reply' });
    this.backLink = page.getByRole('link', { name: 'Back' });
  }

  text(content: string): Locator {
    return this.page.getByText(content);
  }

  @step('Set the message status to {0}')
  async setStatus(status: (typeof MESSAGE_STATUSES)[number]): Promise<void> {
    await this.status.selectOption(status);
  }

  @step('Reply "{0}"')
  async reply(text: string): Promise<void> {
    await this.replyBox.fill(text);
    await this.replyButton.click();
  }
}

export class AdminStatisticsPage {
  readonly shell: AppShell;
  readonly heading: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: 'Statistics', level: 1 });
  }

  /** The data rows of the table under a report heading. */
  report(title: 'Top 10 Best Selling Categories' | 'Top 10 Most Purchased Products' | 'Customers By Country' | 'Total Sales Per Country'): Locator {
    return this.page
      .getByRole('table')
      .filter({ has: this.page.getByRole('columnheader') })
      .nth(['Top 10 Best Selling Categories', 'Top 10 Most Purchased Products', 'Customers By Country', 'Total Sales Per Country'].indexOf(title))
      .getByRole('row')
      .filter({ has: this.page.getByRole('cell') });
  }

  @step('Open the statistics')
  async open(): Promise<void> {
    await this.shell.goto('/admin/reports/statistics');
  }
}

/** The two "average sales per month / per week" reports: a year picker and a chart. */
export class AdminSalesReportPage {
  readonly shell: AppShell;
  readonly heading: Locator;
  readonly year: Locator;
  readonly chart: Locator;

  constructor(readonly page: Page, readonly period: 'month' | 'week') {
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: `Average sales per ${period}` });
    this.year = page.getByRole('combobox', { name: 'Select year' });
    this.chart = page.locator('canvas');
  }

  @step('Open the average sales report')
  async open(): Promise<void> {
    await this.shell.goto(`/admin/reports/average-sales-per-${this.period}`);
  }

  @step('Show the year {0}')
  async showYear(year: string): Promise<void> {
    await this.year.selectOption(year);
  }
}

export class AdminSettingsPage {
  readonly shell: AppShell;
  readonly paymentEndpoint: Locator;
  readonly retrieveGeolocation: Locator;
  readonly co2Features: Locator;
  readonly ecoBadge: Locator;
  readonly saveButton: Locator;
  readonly clearStorageButton: Locator;
  readonly feedback: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.paymentEndpoint = page.getByRole('textbox', { name: 'Payment endpoint' });
    this.retrieveGeolocation = page.getByRole('checkbox', { name: 'Retrieve geolocation' });
    this.co2Features = page.getByRole('checkbox', { name: 'Display CO₂ sustainability features' });
    this.ecoBadge = page.getByRole('checkbox', { name: 'Display eco-friendly badge' });
    this.saveButton = page.getByRole('button', { name: 'Save' });
    this.clearStorageButton = page.getByRole('button', { name: 'Clear storage' });
    this.feedback = page.getByRole('alert').or(page.getByText('Settings saved!'));
  }

  @step('Open the settings')
  async open(): Promise<void> {
    await this.shell.goto('/admin/settings');
  }

  @step('Save the settings')
  async save(): Promise<void> {
    await this.saveButton.click();
  }

  @step('Clear the stored settings')
  async clearStorage(): Promise<void> {
    await this.clearStorageButton.click();
  }

  /** The settings live in localStorage; reading them back is how a save is verified. */
  storedSetting(key: 'PAYMENT_ENDPOINT' | 'CO2_SCALE_ENABLED' | 'ECO_BADGE_ENABLED' | 'RETRIEVE_GEOLOCATION'): Promise<string | null> {
    return this.page.evaluate((k) => localStorage.getItem(k), key);
  }
}

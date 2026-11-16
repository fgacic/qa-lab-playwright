import { expect, type Locator, type Page, type Request } from '@playwright/test';
import { AdminTable } from '@components/admin/AdminTable';
import type { AdminSection } from '@components/Header';
import { apiPath } from '@support/env';
import { step } from '@support/step';
import { AppShell } from '../AppShell';
import { ADMIN_MESSAGES, reportedFailure } from './alerts';

/** The heading each back-office section opens on (the dashboard has none of its own; the orders list says "Order"). */
const SECTION_HEADINGS: Record<AdminSection, string> = {
  Dashboard: 'Sales over the years',
  Brands: 'Brands',
  Categories: 'Categories',
  Products: 'Products',
  Orders: 'Order',
  Users: 'Users',
  Messages: 'Messages',
  Settings: 'Settings',
};

/** The address each back-office section opens on, stated once, so a section whose path stops following its name fails under its own name. */
export const ADMIN_SECTION_PATHS: Record<AdminSection, string> = {
  Dashboard: '/admin/dashboard',
  Brands: '/admin/brands',
  Categories: '/admin/categories',
  Products: '/admin/products',
  Orders: '/admin/orders',
  Users: '/admin/users',
  Messages: '/admin/messages',
  Settings: '/admin/settings',
};

/** The smallest side, in pixels, of a bar of the sales chart: gridlines are thinner, lettering is shorter. */
const MIN_BAR = 20;

/** Every other address of the back office: the reports, the pages that add a record, and the ones that edit or show one (any id will do for a visitor who is turned away). */
const OTHER_ADMIN_ADDRESSES = [
  '/admin/reports/statistics',
  '/admin/reports/average-sales-per-month',
  '/admin/reports/average-sales-per-week',
  '/admin/products/add',
  '/admin/brands/add',
  '/admin/categories/add',
  '/admin/users/add',
  '/admin/products/edit/qalab',
  '/admin/brands/edit/qalab',
  '/admin/categories/edit/qalab',
  '/admin/users/edit/qalab',
  '/admin/orders/edit/qalab',
  '/admin/messages/qalab',
] as const;

/** Every address of the back office a visitor could type: the eight sections and `OTHER_ADMIN_ADDRESSES`. */
export const ADMIN_ADDRESSES: readonly string[] = [...Object.values(ADMIN_SECTION_PATHS), ...OTHER_ADMIN_ADDRESSES];

export class AdminDashboardPage {
  readonly shell: AppShell;
  readonly salesHeading: Locator;
  readonly salesChart: Locator;
  readonly latestOrders: AdminTable;
  /** Shown instead of the table when there is nothing to list. */
  readonly noOrders: Locator;
  /** What the dashboard says when a request fails (an alert, or the site's plain error text): a healthy dashboard shows none. */
  readonly failure: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.failure = reportedFailure(page);
    this.noOrders = page.getByText('No recent invoices.');
    this.salesHeading = page.getByRole('heading', { name: 'Sales over the years' });
    // A <canvas> chart: no role or name to reach it by, and nothing inside it to read.
    this.salesChart = page.locator('canvas');
    this.latestOrders = new AdminTable(page.getByRole('table'));
  }

  /** The heading a section of the admin menu opens on. */
  sectionHeading(section: AdminSection): Locator {
    return this.page.getByRole('heading', { name: SECTION_HEADINGS[section], exact: true });
  }

  /**
   * The heights, in pixels and left to right, of the bars the sales chart has drawn, once its animation has ended. A <canvas>
   * has nothing to read and the app colours each bar at random, so the picture is measured, not compared: a bar is a run
   * of non-white pixels at least `MIN_BAR` tall and `MIN_BAR` wide (gridlines and lettering are neither), and the chart is
   * taken as finished when two reads 250 ms apart agree on the bars and something is drawn at all (axes are drawn even
   * for a report that is empty or failed, so a blank canvas is a chart that has not started).
   */
  @step('Measure the bars of the sales chart')
  async drawnBars(): Promise<number[]> {
    const read = () => this.salesChart.evaluate((canvas: HTMLCanvasElement, minBar: number) => {
      const { width, height } = canvas;
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, width, height);
      const inked = (x: number, y: number) => {
        const at = (y * width + x) * 4;
        return data[at + 3] > 0 && (data[at] < 245 || data[at + 1] < 245 || data[at + 2] < 245);
      };
      const longestRun = (x: number) => {
        let best = 0;
        for (let y = 0, start = -1; y <= height; y++) {
          if (y < height && inked(x, y)) {
            if (start < 0) start = y;
          } else if (start >= 0) {
            best = Math.max(best, y - start);
            start = -1;
          }
        }
        return best;
      };
      let anyInk = false;
      for (let i = 3; i < data.length && !anyInk; i += 4) anyInk = data[i] > 0;
      const bars: number[] = [];
      let from = -1;
      for (let x = 0; x <= width; x++) {
        const tall = x < width ? longestRun(x) : 0;
        if (tall >= minBar) {
          if (from < 0) from = x;
        } else if (from >= 0) {
          if (x - from >= minBar) bars.push(longestRun(Math.floor((from + x) / 2)));
          from = -1;
        }
      }
      return { anyInk, bars };
    }, MIN_BAR);
    let previous = '';
    let bars: number[] = [];
    await expect.poll(async () => {
      const read1 = await read();
      const key = JSON.stringify(read1);
      const settled = read1.anyInk && key === previous;
      previous = key;
      bars = read1.bars;
      return settled;
    }, { message: 'the sales chart finished drawing', intervals: [250] }).toBe(true);
    return bars;
  }

  @step('Open the admin dashboard')
  async open(): Promise<void> {
    await this.shell.gotoAndSettle('/admin/dashboard', 'GET', /^\/invoices$/);
  }

  /** Goes to a back-office address (the dashboard's by default) without waiting for its data: for a visitor who may be turned away before it asks for any. */
  @step('Try to open {0}')
  async tryToOpen(address: string = ADMIN_SECTION_PATHS.Dashboard): Promise<void> {
    await this.shell.goto(address);
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
    this.billingCity = page.getByRole('textbox', { name: 'City' });
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

export const MESSAGE_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const;

/** /admin/messages/{id}: the message, a status picker (saved on change) and a reply box. */
export class AdminMessagePage {
  readonly status: Locator;
  readonly replyBox: Locator;
  readonly replyButton: Locator;
  readonly backLink: Locator;
  /** Any alert of the message page: validation ("... is required"), a failed reply or status change. */
  readonly feedback: Locator;
  /** What the page says when a request fails, in whatever form (an alert, or the site's plain error text). */
  readonly failure: Locator;

  constructor(readonly page: Page) {
    this.feedback = page.getByRole('alert');
    this.failure = reportedFailure(page);
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

/** The four tables of the statistics page, in page order, with the request that fills each. */
const REPORTS = [
  { title: 'Top 10 Best Selling Categories', feed: '/reports/top10-best-selling-categories', columns: ['Category Name', 'Total Earned'] },
  { title: 'Top 10 Most Purchased Products', feed: '/reports/top10-purchased-products', columns: ['Product Name', 'Amount'] },
  { title: 'Customers By Country', feed: '/reports/customers-by-country', columns: ['Country', 'Amount'] },
  { title: 'Total Sales Per Country', feed: '/reports/total-sales-per-country', columns: ['Country', 'Total Earned'] },
] as const;
export type ReportTitle = (typeof REPORTS)[number]['title'];
/** The four report titles, in page order. */
export const REPORT_TITLES: readonly ReportTitle[] = REPORTS.map((r) => r.title);
/** The column titles each report's table has, whatever it is answered with. */
export const reportColumns = (title: ReportTitle): readonly string[] => REPORTS[REPORT_TITLES.indexOf(title)].columns;

export class AdminStatisticsPage {
  readonly shell: AppShell;
  readonly heading: Locator;
  /** What the statistics page says when a request fails (an alert, or the site's plain error text): a healthy page shows none. */
  readonly failure: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: 'Statistics', level: 1 });
    this.failure = reportedFailure(page);
  }

  /**
   * The table of a report. Its heading is a sibling `<h4>` with no relation to the table in the accessibility tree (no
   * region, no `aria-labelledby`), so the table is found by what it is: the column titles of its report (`REPORTS`), which no
   * two reports share as a set. That survives a reordered page and any wrapper around heading and table.
   */
  private table(title: ReportTitle): Locator {
    const { columns } = REPORTS[REPORT_TITLES.indexOf(title)];
    return columns.reduce((tables, column) => tables.filter({ has: this.page.getByRole('columnheader', { name: column, exact: true }) }), this.page.getByRole('table'));
  }

  /** The data rows of the table under a report heading. */
  report(title: ReportTitle): Locator {
    return this.table(title).getByRole('row').filter({ has: this.page.getByRole('cell') });
  }

  /** The cells of one row of a report, in column order: the name, then the figure as the page writes it. */
  cells(title: ReportTitle, row = 0): Locator {
    return this.report(title).nth(row).getByRole('cell');
  }

  /** The column titles of a report (`reportColumns`): all that is left on screen when its answer is empty. */
  columns(title: ReportTitle): Locator {
    return this.table(title).getByRole('columnheader');
  }

  /** Returns once all four reports have been answered, so an empty table means an empty answer. */
  @step('Open the statistics')
  async open(): Promise<void> {
    const answered = Promise.all(REPORTS.map(({ feed }) => this.page.waitForResponse((r) => r.request().method() === 'GET' && apiPath(r.url()) === feed)));
    answered.catch(() => undefined); // a failed navigation is reported by goto; this only keeps the rejection from going unhandled
    await this.shell.goto('/admin/reports/statistics');
    await answered;
  }
}

/** The two "average sales per month / per week" reports: a year picker and a chart. */
export class AdminSalesReportPage {
  readonly shell: AppShell;
  readonly heading: Locator;
  readonly year: Locator;
  readonly yearOptions: Locator;
  readonly chart: Locator;
  private readonly feed: string;

  constructor(readonly page: Page, readonly period: 'month' | 'week') {
    this.feed = `/reports/average-sales-per-${period}`;
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: `Average sales per ${period}` });
    this.year = page.getByRole('combobox', { name: 'Select year' });
    this.yearOptions = this.year.getByRole('option');
    this.chart = page.locator('canvas');
  }

  /** Returns once the report's data has been answered, so a later wait cannot catch this first load. */
  @step('Open the average sales report')
  async open(): Promise<void> {
    const answered = this.page.waitForResponse((r) => r.request().method() === 'GET' && apiPath(r.url()) === this.feed);
    answered.catch(() => undefined); // a failed navigation is reported by goto; this only keeps the rejection from going unhandled
    await this.shell.goto(`/admin/reports/average-sales-per-${this.period}`);
    await answered;
  }

  /**
   * The value of the first year in the picker that is not the one selected (a value against a value, never a label against
   * a value), so a test that changes the year really changes it, whatever year the picker opens on or stops at (ADM-08).
   * Call it once the options are drawn.
   */
  async anotherYear(): Promise<string> {
    const selected = await this.year.inputValue();
    const years = await Promise.all((await this.yearOptions.all()).map((option) => option.getAttribute('value')));
    const other = years.find((year): year is string => year !== null && year !== selected);
    if (!other) throw new Error(`The year picker offers only the selected year (${selected}): there is no other year to pick.`);
    return other;
  }

  /** The year of the page's own clock (not the test runner's, and so still the one the picker reads if the suite ever installs `page.clock`): the year the picker has to reach. */
  async currentYear(): Promise<string> {
    return String(await this.page.evaluate(() => new Date().getFullYear()));
  }

  /** Picks a year and returns the next report request that carries a `?year=`; the spec asserts which year it asked for. */
  @step('Show the year {0}')
  async showYear(year: string): Promise<Request> {
    const reloaded = this.page.waitForRequest((r) => r.method() === 'GET' && apiPath(r.url()) === this.feed && new URL(r.url()).searchParams.has('year'));
    await this.year.selectOption(year);
    return reloaded;
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
  /** What the page says after Save: the "Settings saved!" confirmation (plain text, no role) or an error alert. */
  readonly feedback: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.paymentEndpoint = page.getByRole('textbox', { name: 'Payment endpoint' });
    this.retrieveGeolocation = page.getByRole('checkbox', { name: 'Retrieve geolocation' });
    this.co2Features = page.getByRole('checkbox', { name: 'Display CO₂ sustainability features' });
    this.ecoBadge = page.getByRole('checkbox', { name: 'Display eco-friendly badge' });
    this.saveButton = page.getByRole('button', { name: 'Save' });
    this.clearStorageButton = page.getByRole('button', { name: 'Clear storage' });
    this.feedback = page.getByRole('alert').or(page.getByText(ADMIN_MESSAGES.settingsSaved));
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

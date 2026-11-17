import type { Locator, Page, Request } from '@playwright/test';
import { apiPath } from '@support/env';
import { step } from '@support/step';
import { AppShell } from '../AppShell';
import { reportedFailure } from './alerts';

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
  /** What the report says when a request fails (an alert, or the site's plain error text): a healthy report shows none. */
  readonly failure: Locator;
  private readonly feed: string;

  constructor(readonly page: Page, readonly period: 'month' | 'week') {
    this.feed = `/reports/average-sales-per-${period}`;
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: `Average sales per ${period}` });
    this.year = page.getByRole('combobox', { name: 'Select year' });
    this.yearOptions = this.year.getByRole('option');
    this.chart = page.locator('canvas');
    this.failure = reportedFailure(page);
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

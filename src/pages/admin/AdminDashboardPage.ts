import { expect, type Locator, type Page } from '@playwright/test';
import { AdminTable } from '@components/admin/AdminTable';
import type { AdminSection } from '@components/Header';
import { MIN_BAR, measureBars } from '@support/admin-chart';
import { step } from '@support/step';
import { AppShell } from '../AppShell';
import { reportedFailure } from './alerts';
import { ADMIN_SECTION_PATHS, SECTION_HEADINGS } from './admin-sections';

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
    const read = () => this.salesChart.evaluate(measureBars, MIN_BAR);
    let previous = '';
    let bars: number[] = [];
    await expect.poll(async () => {
      const chart = await read();
      const key = JSON.stringify(chart);
      const settled = chart.anyInk && key === previous;
      previous = key;
      bars = chart.bars;
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

import type { Locator, Page } from '@playwright/test';
import { AdminTable } from '@components/admin/AdminTable';
import type { AdminSection } from '@components/Header';
import { drawnBars } from '@support/admin-chart';
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

  /** The heights of the bars the sales chart has drawn, once its animation has ended (`drawnBars` in admin-chart). */
  @step('Measure the bars of the sales chart')
  async drawnBars(): Promise<number[]> {
    return drawnBars(this.salesChart);
  }

  @step('Open the admin dashboard')
  async open(): Promise<void> {
    await this.shell.gotoAndSettle(ADMIN_SECTION_PATHS.Dashboard, 'GET', /^\/invoices$/);
  }

  /** Goes to a back-office address (the dashboard's by default) without waiting for its data: for a visitor who may be turned away before it asks for any. */
  @step('Try to open {0}')
  async tryToOpen(address: string = ADMIN_SECTION_PATHS.Dashboard): Promise<void> {
    await this.shell.goto(address);
  }
}

import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';

/** "Live shop activity": a panel fed by Server-Sent Events from GET /sales-stream. */
export class LiveActivityPanel {
  readonly openButton: Locator;
  readonly window: Locator;
  readonly closeButton: Locator;
  readonly salesCount: Locator;
  readonly revenue: Locator;
  readonly emptyState: Locator;
  readonly items: Locator;

  constructor(page: Page) {
    this.openButton = page.getByRole('button', { name: 'Show live shop activity' });
    this.window = page.getByTestId('live-activity-window');
    this.closeButton = this.window.getByRole('button', { name: 'Close' });
    this.salesCount = this.window.getByTestId('live-activity-count');
    this.revenue = this.window.getByTestId('live-activity-revenue');
    this.emptyState = this.window.getByTestId('live-activity-empty');
    this.items = this.window.getByTestId('live-activity-item');
  }

  @step('Open the live shop activity')
  async open(): Promise<void> {
    await this.openButton.click();
  }

  @step('Close the live shop activity')
  async close(): Promise<void> {
    await this.closeButton.click();
  }
}

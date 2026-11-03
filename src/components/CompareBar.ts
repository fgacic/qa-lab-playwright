import type { Locator } from '@playwright/test';
import { step } from '@support/step';

/** The sticky bar that appears once a product is picked for comparison. */
export class CompareBar {
  readonly selection: Locator;
  readonly clearAllButton: Locator;
  readonly compareNowLink: Locator;

  constructor(readonly root: Locator) {
    this.selection = root.getByText(/product\(s\) selected/);
    this.clearAllButton = root.getByRole('button', { name: 'Clear All' });
    this.compareNowLink = root.getByRole('link', { name: 'Compare Now' });
  }

  @step('Clear the comparison')
  async clearAll(): Promise<void> {
    await this.clearAllButton.click();
  }

  @step('Open the comparison')
  async compareNow(): Promise<void> {
    await this.compareNowLink.click();
  }
}

import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from './AppShell';

export class ComparisonPage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly table: Locator;
  readonly productColumns: Locator;
  readonly showDifferencesOnly: Locator;
  readonly clearAllButton: Locator;
  readonly emptyState: Locator;
  readonly browseProductsLink: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByRole('heading', { name: 'Product Comparison' });
    this.table = page.getByRole('table', { name: 'Product Comparison' });
    this.productColumns = this.table.getByRole('columnheader', { name: /^Remove .+ from comparison/ });
    this.showDifferencesOnly = page.getByRole('checkbox', { name: 'Show differences only' });
    this.clearAllButton = page.getByRole('button', { name: 'Clear All' });
    this.emptyState = page.getByText('No products selected for comparison. Add products from the overview page.');
    this.browseProductsLink = page.getByRole('link', { name: 'Browse Products' });
  }

  /** A comparison row by its header ("Price", "Brand", a spec name...). Cells follow in column order. */
  row(header: string): Locator {
    return this.table.getByRole('row').filter({ has: this.page.getByRole('rowheader', { name: header, exact: true }) });
  }

  cells(header: string): Locator {
    return this.row(header).getByRole('cell');
  }

  @step('Open the comparison page')
  async open(): Promise<void> {
    await this.shell.goto('/comparison');
  }

  @step('Remove "{0}" from the comparison')
  async remove(productName: string): Promise<void> {
    await this.table.getByRole('button', { name: `Remove ${productName} from comparison` }).click();
  }

  @step('Clear the comparison')
  async clearAll(): Promise<void> {
    await this.clearAllButton.click();
  }
}

import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from './AppShell';

/** The sessionStorage key under which the app keeps the ids of the products picked for comparison. */
export const COMPARE_STORAGE_KEY = 'compare_ids';

/** The row headers of the comparison table. */
export const COMPARISON_ROW = { price: 'Price', brand: 'Brand', category: 'Category', availability: 'Availability', co2: 'CO₂ Rating' } as const;

/** What the Availability row says of a product. */
export const AVAILABILITY = { inStock: 'In Stock', outOfStock: 'Out of Stock' } as const;

/** A price as the table shows it: a dollar sign and two decimals. */
export const priceText = (price: number): string => `$${price.toFixed(2)}`;

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

  /** The ids of the products the app has stored for comparison (this tab's session), in the order they were picked. */
  async selectedIds(): Promise<string[]> {
    return this.page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[], COMPARE_STORAGE_KEY);
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

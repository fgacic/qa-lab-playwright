import type { Locator, Page } from '@playwright/test';
import { ProductGrid } from '@components/ProductGrid';
import { step } from '@support/step';
import { AppShell } from './AppShell';
import { ProductPage } from './ProductPage';

export class RentalsPage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly grid: ProductGrid;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByRole('heading', { name: 'Rentals', level: 1 });
    // Rental cards are focusable <div>s, not links, so the test id is the only stable handle.
    this.grid = new ProductGrid(page.locator('body'), page.getByTestId(/^product-[0-9A-Z]{26}$/));
  }

  @step('Open the rentals page')
  async open(): Promise<void> {
    await this.shell.gotoAndSettle('/rentals', 'QUERY', /^\/products$/);
  }

  @step('Open the rental "{0}"')
  async openRental(name: string): Promise<ProductPage> {
    await this.grid.open(name);
    return new ProductPage(this.page);
  }
}

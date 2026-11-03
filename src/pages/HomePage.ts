import type { Locator, Page } from '@playwright/test';
import { CompareBar } from '@components/CompareBar';
import { FilterPanel } from '@components/FilterPanel';
import { Pagination } from '@components/Pagination';
import { ProductGrid } from '@components/ProductGrid';
import { SearchBar } from '@components/SearchBar';
import { step } from '@support/step';
import { AppShell } from './AppShell';
import { CheckoutPage } from './CheckoutPage';
import { ComparisonPage } from './ComparisonPage';
import { ProductPage } from './ProductPage';

export class HomePage {
  readonly shell: AppShell;
  readonly heading: Locator;
  readonly search: SearchBar;
  readonly filters: FilterPanel;
  readonly grid: ProductGrid;
  readonly pagination: Pagination;
  readonly compareBar: CompareBar;

  constructor(readonly page: Page) {
    const body = page.locator('body');
    this.shell = new AppShell(page);
    this.heading = page.getByRole('heading', { name: 'Practice Software Testing - Toolshop', level: 1 });
    this.search = new SearchBar(body);
    this.filters = new FilterPanel(body);
    this.grid = new ProductGrid(body);
    this.pagination = new Pagination(page.getByRole('navigation').filter({ has: page.getByRole('button', { name: 'Previous' }) }));
    this.compareBar = new CompareBar(page.getByTestId('comparison-bar'));
  }

  get header() {
    return this.shell.header;
  }

  @step('Open the home page')
  async open(): Promise<void> {
    await this.shell.gotoAndSettle('/', 'QUERY', /^\/products$/);
  }

  @step('Open the product "{0}" from the grid')
  async openProduct(name: string): Promise<ProductPage> {
    await this.grid.open(name);
    return new ProductPage(this.page);
  }

  /** Opens the first product in the grid that can be bought, and returns its name too. */
  @step('Open the first product that is in stock')
  async openFirstInStockProduct(): Promise<{ name: string; productPage: ProductPage }> {
    const card = this.grid.firstInStock();
    const name = await card.name.innerText();
    await card.root.click();
    return { name, productPage: new ProductPage(this.page) };
  }

  @step('Open the comparison from the bar')
  async openComparison(): Promise<ComparisonPage> {
    await this.compareBar.compareNow();
    return new ComparisonPage(this.page);
  }

  @step('Open the cart from the header')
  async openCart(): Promise<CheckoutPage> {
    await this.header.openCart();
    return new CheckoutPage(this.page);
  }
}

import type { Locator, Page } from '@playwright/test';
import { FilterPanel } from '@components/FilterPanel';
import { Pagination } from '@components/Pagination';
import { ProductGrid } from '@components/ProductGrid';
import { step } from '@support/step';
import { AppShell } from './AppShell';

export class CategoryPage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly grid: ProductGrid;
  readonly filters: FilterPanel;
  readonly pagination: Pagination;
  readonly notFoundMessage: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByTestId('page-title');
    const body = page.locator('body');
    this.grid = new ProductGrid(body);
    this.filters = new FilterPanel(body);
    this.pagination = new Pagination(page.getByRole('navigation').filter({ has: page.getByRole('button', { name: 'Previous' }) }));
    this.notFoundMessage = page.getByText(/not found|does not exist|doesn't exist|unknown category/i);
  }

  @step('Open the category page /category/{0}')
  async open(slug: string): Promise<void> {
    await this.shell.gotoAndSettle(`/category/${slug}`, 'QUERY', /^\/products$/);
  }
}

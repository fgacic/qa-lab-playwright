import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export class FavoritesPage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly favorites: Locator;
  readonly emptyState: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByTestId('page-title');
    this.favorites = page.getByTestId(/^favorite-/);
    this.emptyState = page.getByText('There are no favorites yet.', { exact: false });
  }

  favorite(productName: string): Locator {
    return this.favorites.filter({ hasText: productName });
  }

  @step('Open my favorites')
  async open(): Promise<void> {
    await this.shell.goto('/account/favorites');
  }

  @step('Remove "{0}" from my favorites')
  async remove(productName: string): Promise<void> {
    await this.favorite(productName).getByTestId('delete').click();
  }
}

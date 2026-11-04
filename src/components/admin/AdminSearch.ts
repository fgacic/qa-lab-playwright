import type { Locator } from '@playwright/test';
import { step } from '@support/step';

/** "Search brands / products / users / orders / categories" above each list. */
export class AdminSearch {
  readonly query: Locator;
  readonly searchButton: Locator;
  readonly resetButton: Locator;

  constructor(root: Locator, label: string) {
    this.query = root.getByRole('textbox', { name: label });
    this.searchButton = root.getByRole('button', { name: 'Search', exact: true });
    this.resetButton = root.getByRole('button', { name: 'Reset', exact: true });
  }

  @step('Search the list for "{0}"')
  async searchFor(term: string): Promise<void> {
    await this.query.fill(term);
    await this.searchButton.click();
  }

  @step('Reset the list search')
  async reset(): Promise<void> {
    await this.resetButton.click();
  }
}

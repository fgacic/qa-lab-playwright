import type { Locator } from '@playwright/test';
import { API_URL } from '@support/env';
import { step } from '@support/step';

export class SearchBar {
  readonly query: Locator;
  readonly submitButton: Locator;
  readonly resetButton: Locator;
  /** "Searched for: <term>" */
  readonly caption: Locator;
  /** "<n> products found for '<term>'" */
  readonly resultCount: Locator;
  /** The sidebar toggle on phones (see FilterPanel). */
  private readonly sidebarToggle: Locator;

  constructor(root: Locator) {
    this.sidebarToggle = root.getByRole('button', { name: 'Filters', exact: true });
    this.query = root.getByRole('textbox', { name: 'Search' });
    this.submitButton = root.getByRole('button', { name: 'Search', exact: true });
    this.resetButton = root.getByRole('button', { name: 'X', exact: true });
    this.caption = root.getByTestId('search-caption');
    this.resultCount = root.getByTestId('search-result-count');
  }

  /** Submits the search and waits for its answer, so the grid shows the results, not the old list. */
  @step('Search for "{0}"')
  async searchFor(term: string, { submitWith = 'button' }: { submitWith?: 'button' | 'enter' } = {}): Promise<void> {
    if ((await this.sidebarToggle.isVisible()) && !(await this.query.isVisible())) await this.sidebarToggle.click();
    const answered = this.query.page().waitForResponse((r) => r.url() === `${API_URL}/products/search` && r.request().method() === 'QUERY');
    await this.query.fill(term);
    if (submitWith === 'enter') await this.query.press('Enter');
    else await this.submitButton.click();
    await answered;
  }

  @step('Clear the search')
  async reset(): Promise<void> {
    await this.resetButton.click();
  }
}

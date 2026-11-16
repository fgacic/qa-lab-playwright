import type { Locator } from '@playwright/test';
import { API_URL } from '@support/env';
import { step } from '@support/step';

/**
 * The wording of a message that says why a term was not searched: it names the length rule ("at least 3 characters",
 * "too long"). Deliberately both parts, a length word and "character(s)", so a toast about something else never counts.
 */
const LENGTH_RULE = /(?:at least|at most|no more than|too (?:short|long)|minimum|maximum)\b[^.]*\bcharacters?\b|\bcharacters?\b[^.]*(?:at least|at most|too (?:short|long)|minimum|maximum)/i;

/** What the shop prints about a search, word for word: the caption over the grid and the count under it. */
export const searchedFor = (term: string): string => `Searched for: ${term}`;
export const productsFoundFor = (count: number, term: string): string => `${count} products found for '${term}'`;

export class SearchBar {
  readonly query: Locator;
  readonly submitButton: Locator;
  readonly resetButton: Locator;
  /** "Searched for: <term>" */
  readonly caption: Locator;
  /** "<n> products found for '<term>'" */
  readonly resultCount: Locator;
  /**
   * The text that says why a term was not searched (too short or too long), wherever the shop draws it. Tight on purpose:
   * the shop's other messages (a toast about the cart, an error banner) must not count as an explanation.
   */
  readonly termExplanation: Locator;
  /** The sidebar toggle on phones (see FilterPanel). */
  private readonly sidebarToggle: Locator;

  constructor(root: Locator) {
    this.sidebarToggle = root.getByRole('button', { name: 'Filters', exact: true });
    this.query = root.getByRole('textbox', { name: 'Search' });
    this.submitButton = root.getByRole('button', { name: 'Search', exact: true });
    this.resetButton = root.getByRole('button', { name: 'X', exact: true });
    this.caption = root.getByTestId('search-caption');
    this.resultCount = root.getByTestId('search-result-count');
    this.termExplanation = root.getByText(LENGTH_RULE).first();
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

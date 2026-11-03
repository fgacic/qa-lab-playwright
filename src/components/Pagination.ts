import type { Locator } from '@playwright/test';
import { step } from '@support/step';

export class Pagination {
  readonly previous: Locator;
  readonly next: Locator;

  constructor(readonly root: Locator) {
    this.previous = root.getByRole('button', { name: 'Previous' });
    this.next = root.getByRole('button', { name: 'Next' });
  }

  page(n: number): Locator {
    return this.root.getByRole('button', { name: `Page-${n}`, exact: true });
  }

  /** How many numbered page buttons there are, i.e. the number of pages. */
  async pageCount(): Promise<number> {
    await this.page(1).waitFor();
    return this.root.getByRole('button', { name: /^Page-\d+$/ }).count();
  }

  @step('Go to page {0}')
  async goTo(n: number): Promise<void> {
    await this.page(n).click();
  }

  @step('Go to the next page')
  async goNext(): Promise<void> {
    await this.next.click();
  }

  @step('Go to the previous page')
  async goPrevious(): Promise<void> {
    await this.previous.click();
  }
}

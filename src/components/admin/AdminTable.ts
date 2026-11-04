import type { Locator } from '@playwright/test';
import { step } from '@support/step';

/** A back-office list: one row per record, ending in "Edit" (and usually "Delete" or "Details"). */
export class AdminTable {
  readonly rows: Locator;

  constructor(readonly root: Locator) {
    // Data rows are the ones with cells; the header row only has column headers.
    this.rows = root.getByRole('row').filter({ has: root.page().getByRole('cell') });
  }

  /** The row that mentions `text` anywhere (an id, a name, an invoice number...). */
  row(text: string): Locator {
    return this.rows.filter({ hasText: text });
  }

  @step('Open "{0}" for editing')
  async edit(text: string): Promise<void> {
    await this.row(text).getByRole('link', { name: 'Edit' }).click();
  }

  @step('Delete "{0}"')
  async delete(text: string): Promise<void> {
    await this.row(text).getByRole('button', { name: 'Delete' }).click();
  }

  @step('Open the details of "{0}"')
  async details(text: string): Promise<void> {
    await this.row(text).getByRole('link', { name: 'Details' }).click();
  }
}

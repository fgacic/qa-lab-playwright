import type { Dialog, Locator } from '@playwright/test';
import { step } from '@support/step';

/** A back-office list: one row per record, ending in "Edit" (and usually "Delete" or "Details"). */
export class AdminTable {
  readonly rows: Locator;
  readonly columnHeaders: Locator;

  constructor(readonly root: Locator) {
    // Data rows are the ones with cells; the header row only has column headers.
    this.rows = root.getByRole('row').filter({ has: root.page().getByRole('cell') });
    this.columnHeaders = root.getByRole('columnheader');
  }

  /** One column title: what is left on screen when a list has no rows. */
  columnHeader(name: string): Locator {
    return this.columnHeaders.filter({ hasText: name });
  }

  /** The row that mentions `text` anywhere (an id, a name, an invoice number...). */
  row(text: string): Locator {
    return this.rows.filter({ hasText: text });
  }

  /**
   * The status pill of a message or order row (a bare <span>, no role: reached by its text).
   * Without `rowText` it matches the pill in every row that shows `status`.
   */
  statusBadge(status: string, rowText?: string): Locator {
    return (rowText === undefined ? this.rows : this.row(rowText)).getByRole('cell').getByText(status, { exact: true });
  }

  @step('Open "{0}" for editing')
  async edit(text: string): Promise<void> {
    await this.row(text).getByRole('link', { name: 'Edit' }).click();
  }

  /**
   * Clicks Delete on the row and accepts the native `confirm()` the site may ask for (ADM-02: today it asks nothing;
   * once fixed it may open a `confirm()`, which Playwright dismisses on its own when no handler is attached, so a plain
   * click would cancel the delete and the test would wait forever). An in-page confirmation dialog is not answered here:
   * the day the site draws one, the specs that need the record gone say so by failing, and learn its buttons then.
   */
  @step('Delete "{0}"')
  async delete(text: string): Promise<void> {
    const page = this.root.page();
    const onDialog = (dialog: Dialog) => dialog.accept();
    page.on('dialog', onDialog);
    try {
      // A confirm() blocks the click handler, so the click returns once the dialog has been answered.
      await this.row(text).getByRole('button', { name: 'Delete' }).click();
    } finally {
      page.off('dialog', onDialog);
    }
  }

  /**
   * Clicks Delete and confirms nothing: a native `confirm()` is dismissed, and an in-page dialog is left unanswered,
   * which refuses it just the same. What the caller then checks is that no DELETE was sent (ADM-02), whichever
   * form the question takes.
   */
  @step('Click Delete on "{0}" without confirming')
  async deleteWithoutConfirming(text: string): Promise<void> {
    const page = this.root.page();
    const onDialog = (dialog: Dialog) => dialog.dismiss();
    page.on('dialog', onDialog);
    try {
      await this.row(text).getByRole('button', { name: 'Delete' }).click();
    } finally {
      page.off('dialog', onDialog);
    }
  }

  @step('Open the details of "{0}"')
  async details(text: string): Promise<void> {
    await this.row(text).getByRole('link', { name: 'Details' }).click();
  }
}

import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { reportedFailure } from './alerts';

export const MESSAGE_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** /admin/messages/{id}: the message, a status picker (saved on change) and a reply box. */
export class AdminMessagePage {
  readonly status: Locator;
  readonly replyBox: Locator;
  readonly replyButton: Locator;
  readonly backLink: Locator;
  /** Any alert of the message page: validation ("... is required"), a failed reply or status change. */
  readonly feedback: Locator;
  /** What the page says when a request fails, in whatever form (an alert, or the site's plain error text). */
  readonly failure: Locator;

  constructor(readonly page: Page) {
    this.feedback = page.getByRole('alert');
    this.failure = reportedFailure(page);
    this.status = page.getByRole('combobox', { name: 'Status' });
    this.replyBox = page.getByRole('textbox', { name: 'Reply message' });
    this.replyButton = page.getByRole('button', { name: 'Reply' });
    this.backLink = page.getByRole('link', { name: 'Back' });
  }

  /** The element that shows exactly `content`: exact, so a text that is part of another one on the page cannot trip strict mode. */
  text(content: string): Locator {
    return this.page.getByText(content, { exact: true });
  }

  @step('Set the message status to {0}')
  async setStatus(status: MessageStatus): Promise<void> {
    await this.status.selectOption(status);
  }

  @step('Reload the message')
  async reload(): Promise<void> {
    await this.page.reload();
  }

  @step('Reply "{0}"')
  async reply(text: string): Promise<void> {
    await this.replyBox.fill(text);
    await this.replyButton.click();
  }
}

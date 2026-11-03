import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export class MessagesPage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly messageRows: Locator;
  readonly emptyState: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByTestId('page-title');
    this.messageRows = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Details' }) });
    this.emptyState = page.getByText('There are no messages yet.', { exact: false });
  }

  @step('Open my messages')
  async open(): Promise<void> {
    await this.shell.goto('/account/messages');
  }

  @step('Open the message about "{0}"')
  async openDetails(subject: string): Promise<MessageDetailsPage> {
    await this.messageRows.filter({ hasText: subject }).getByRole('link', { name: 'Details' }).click();
    return new MessageDetailsPage(this.page);
  }
}

export class MessageDetailsPage {
  readonly backLink: Locator;
  readonly repliesHeading: Locator;
  readonly reply: Locator;
  readonly replyButton: Locator;

  constructor(readonly page: Page) {
    this.backLink = page.getByRole('link', { name: 'Back' }).or(page.getByRole('button', { name: 'Back' }));
    this.repliesHeading = page.getByRole('heading', { name: 'Replies' });
    this.reply = page.getByRole('textbox');
    this.replyButton = page.getByRole('button', { name: 'Reply' });
  }

  text(content: string): Locator {
    return this.page.getByText(content);
  }
}

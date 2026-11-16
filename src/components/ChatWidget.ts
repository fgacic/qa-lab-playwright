import { expect, type Locator, type Page } from '@playwright/test';
import { step } from '@support/step';
import type { ContactSubject } from '@support/payloads';
import type { Person } from '@support/test-data';

export type ChatAction = 'Find a product' | 'Order a product' | 'Checkout' | 'Create support ticket';

export class ChatWidget {
  readonly openButton: Locator;
  readonly window: Locator;
  readonly closeButton: Locator;
  readonly greeting: Locator;
  readonly input: Locator;
  readonly sendButton: Locator;
  readonly productResults: Locator;

  constructor(page: Page) {
    this.openButton = page.getByRole('button', { name: 'Open chat' });
    this.window = page.getByTestId('chat-window');
    this.closeButton = this.window.getByRole('button', { name: 'Close chat' });
    this.greeting = this.window.getByText('Hi! How can I help you today?');
    this.input = this.window.getByRole('textbox', { name: 'Message' });
    this.sendButton = this.window.getByRole('button', { name: 'Send message' });
    this.productResults = this.window.getByTestId('chat-product');
  }

  /** A product card the assistant listed, by the product's name. Each card shows the name and the price. */
  productResult(name: string): Locator {
    return this.productResults.filter({ hasText: name });
  }

  /** The newest bot reply. Earlier replies stay in the transcript. */
  reply(text: string | RegExp): Locator {
    return this.window.getByText(text).last();
  }

  /**
   * Every line of the transcript with exactly this text, whoever said it: what the visitor typed, or a question the assistant
   * asked. A question asked again shows up as a second one, so `toHaveCount(1)` proves it was asked once.
   */
  line(text: string): Locator {
    return this.window.getByText(text, { exact: true });
  }

  action(name: ChatAction): Locator {
    return this.window.getByRole('button', { name, exact: true }).last();
  }

  /** Opens the chat and waits for its fade-in to finish (half-faded text reads as low contrast). */
  @step('Open the chat')
  async open(): Promise<void> {
    await this.openButton.click();
    await expect(this.window).toHaveCSS('opacity', '1');
  }

  @step('Close the chat')
  async close(): Promise<void> {
    await this.closeButton.click();
  }

  @step('Pick "{0}" in the chat')
  async choose(action: ChatAction): Promise<void> {
    await this.action(action).click();
  }

  /** Click one of the answer buttons the assistant offers (subjects, confirmations...). */
  @step('Answer the chat with "{0}"')
  async pick(option: string): Promise<void> {
    await this.window.getByRole('button', { name: option, exact: true }).last().click();
  }

  /**
   * Answers the support-ticket dialogue as far as its attachment question: the three personal questions, the subject and the
   * description. The ticket is not sent yet: what follows (skip or attach) is the caller's.
   */
  @step('Answer the support-ticket questions as {0.email}')
  async fillTicketUntilAttachment(guest: Person, subject: ContactSubject, description: string): Promise<void> {
    await this.choose('Create support ticket');
    await this.send(guest.firstName);
    await this.send(guest.lastName);
    await this.send(guest.email);
    await this.pick(subject);
    await this.send(description);
  }

  @step('Ask the chat for "{0}"')
  async findProduct(term: string): Promise<void> {
    await this.choose('Find a product');
    await this.send(term);
  }

  @step('Send "{0}" in the chat')
  async send(text: string): Promise<void> {
    await this.input.fill(text);
    await this.sendButton.click();
  }

  /** The same, with the keyboard: Enter in the message box instead of a click on the send button. */
  @step('Send "{0}" in the chat with Enter')
  async sendWithEnter(text: string): Promise<void> {
    await this.input.fill(text);
    await this.input.press('Enter');
  }

  @step('Close the chat with Escape')
  async closeWithEscape(): Promise<void> {
    await this.input.press('Escape');
  }

  @step('Go back to the chat menu')
  async backToMenu(): Promise<void> {
    await this.window.getByRole('button', { name: 'Back to menu' }).last().click();
  }
}

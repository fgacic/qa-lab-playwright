import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';

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

  /** The newest bot reply. Earlier replies stay in the transcript. */
  reply(text: string | RegExp): Locator {
    return this.window.getByText(text).last();
  }

  action(name: ChatAction): Locator {
    return this.window.getByRole('button', { name, exact: true }).last();
  }

  @step('Open the chat')
  async open(): Promise<void> {
    await this.openButton.click();
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

  @step('Go back to the chat menu')
  async backToMenu(): Promise<void> {
    await this.window.getByRole('button', { name: 'Back to menu' }).last().click();
  }
}

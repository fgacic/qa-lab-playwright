import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';
import type { Person } from '@support/test-data';
import { AppShell } from './AppShell';

export const CONTACT_SUBJECTS = ['Customer service', 'Webmaster', 'Return', 'Payments', 'Warranty', 'Status of my order'] as const;
export type ContactSubject = (typeof CONTACT_SUBJECTS)[number];

export interface ContactMessage {
  from: Person;
  subject: ContactSubject;
  message: string;
  attachment?: { name: string; mimeType: string; buffer: Buffer };
}

export class ContactPage {
  readonly shell: AppShell;
  readonly heading: Locator;
  readonly firstName: FormField;
  readonly lastName: FormField;
  readonly email: FormField;
  readonly subject: FormField;
  readonly message: FormField;
  readonly attachment: FormField;
  readonly sendButton: Locator;
  readonly successMessage: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    const body = page.locator('body');
    this.heading = page.getByRole('heading', { name: 'Contact', exact: true });
    this.firstName = new FormField(body, 'First name', 'first-name-error');
    this.lastName = new FormField(body, 'Last name', 'last-name-error');
    this.email = new FormField(body, 'Email address', 'email-error');
    this.subject = new FormField(body, 'Subject', 'subject-error');
    this.message = new FormField(body, 'Message *', 'message-error');
    this.attachment = new FormField(body, 'Attachment', 'attachment-error');
    this.sendButton = page.getByRole('button', { name: 'Send' });
    this.successMessage = page.getByRole('alert').filter({ hasText: 'Thanks for your message! We will contact you shortly.' });
  }

  /** A status line by its text: server errors render in an untagged box above the button. */
  statusMessage(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  @step('Open the contact page')
  async open(): Promise<void> {
    await this.shell.goto('/contact');
  }

  @step('Write a "{0.subject}" message')
  async fillIn(contact: ContactMessage): Promise<void> {
    await this.firstName.input.fill(contact.from.firstName);
    await this.lastName.input.fill(contact.from.lastName);
    await this.email.input.fill(contact.from.email);
    await this.subject.input.selectOption({ label: contact.subject });
    await this.message.input.fill(contact.message);
    if (contact.attachment) await this.attachment.input.setInputFiles(contact.attachment);
  }

  @step('Send a "{0.subject}" message')
  async send(contact: ContactMessage): Promise<void> {
    await this.fillIn(contact);
    await this.submit();
  }

  @step('Submit the contact form')
  async submit(): Promise<void> {
    await this.sendButton.click();
  }
}

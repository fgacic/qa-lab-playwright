import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';
import type { ContactSubject } from '@support/payloads';
import type { Person } from '@support/test-data';
import { AppShell } from './AppShell';

export interface ContactMessage {
  from: Person;
  subject: ContactSubject;
  message: string;
  attachment?: { name: string; mimeType: string; buffer: Buffer };
}

export class ContactPage {
  readonly shell: AppShell;
  readonly form: Locator;
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
    // The form has no accessible name and no test id, so its element is the only handle that keeps a status line inside it.
    const form = page.locator('form');
    this.form = form;
    this.heading = page.getByRole('heading', { name: 'Contact', exact: true });
    this.firstName = new FormField(form, 'First name', 'first-name-error');
    this.lastName = new FormField(form, 'Last name', 'last-name-error');
    this.email = new FormField(form, 'Email address', 'email-error');
    this.subject = new FormField(form, 'Subject', 'subject-error');
    this.message = new FormField(form, 'Message *', 'message-error');
    this.attachment = new FormField(form, 'Attachment', 'attachment-error');
    this.sendButton = page.getByRole('button', { name: 'Send' });
    this.successMessage = page.getByRole('alert').filter({ hasText: 'Thanks for your message! We will contact you shortly.' });
  }

  /** A status line of the form by its text: server errors render in an untagged box below the button. */
  statusMessage(text: string | RegExp): Locator {
    return this.form.getByText(text);
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

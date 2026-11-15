import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';
import { AppShell } from './AppShell';

export class ForgotPasswordPage {
  readonly shell: AppShell;
  readonly form: Locator;
  readonly heading: Locator;
  readonly email: FormField;
  readonly submitButton: Locator;
  readonly alert: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    const form = page.getByTestId('forgot-password-form');
    this.form = form;
    this.heading = page.getByRole('heading', { name: 'Forgot Password' });
    this.email = new FormField(form, 'Email address *', 'email-error');
    this.submitButton = form.getByRole('button', { name: 'Set New Password' });
    this.alert = form.getByRole('alert');
  }

  /** The result message the form shows (success or error): an alert inside the form. */
  statusMessage(text: string | RegExp): Locator {
    return this.form.getByRole('alert').filter({ hasText: text });
  }

  @step('Open the forgot-password page')
  async open(): Promise<void> {
    await this.shell.goto('/auth/forgot-password');
  }

  @step('Request a new password for {0}')
  async requestReset(email: string): Promise<void> {
    await this.email.input.fill(email);
    await this.submitButton.click();
  }
}

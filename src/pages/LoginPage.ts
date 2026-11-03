import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';
import { AccountPage } from './account/AccountPage';
import { AppShell } from './AppShell';

export class LoginPage {
  readonly shell: AppShell;
  readonly heading: Locator;
  readonly email: FormField;
  readonly password: FormField;
  readonly showPasswordButton: Locator;
  readonly loginButton: Locator;
  readonly googleButton: Locator;
  readonly error: Locator;
  readonly registerLink: Locator;
  readonly forgotPasswordLink: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    const form = page.getByTestId('login-form');
    this.heading = page.getByRole('heading', { name: 'Login', level: 3 });
    this.email = new FormField(form, 'Email address *', 'email-error');
    this.password = new FormField(form, 'Password *', 'password-error');
    // The eye icon button has no accessible name (A11Y-02); it is the form's only unnamed button.
    this.showPasswordButton = form.getByRole('button', { name: '', exact: true });
    this.loginButton = form.getByRole('button', { name: 'Login' });
    this.googleButton = page.getByRole('button', { name: 'Sign in with Google' });
    this.error = page.getByTestId('login-error');
    this.registerLink = page.getByRole('link', { name: 'Register your account' });
    this.forgotPasswordLink = page.getByRole('link', { name: 'Forgot your Password?' });
  }

  @step('Open the login page')
  async open(): Promise<void> {
    await this.shell.goto('/auth/login');
  }

  /** Returns the account page, where a successful login lands. */
  @step('Log in as {0}')
  async login(email: string, password: string): Promise<AccountPage> {
    await this.email.input.fill(email);
    await this.password.input.fill(password);
    await this.loginButton.click();
    return new AccountPage(this.page);
  }
}

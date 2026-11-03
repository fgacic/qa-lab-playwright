import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export class ProfilePage {
  readonly shell: AppShell;
  readonly title: Locator;
  readonly firstName: FormField;
  readonly lastName: FormField;
  readonly email: FormField;
  readonly phone: FormField;
  readonly street: FormField;
  readonly postalCode: FormField;
  readonly city: FormField;
  readonly state: FormField;
  readonly country: FormField;
  readonly updateProfileButton: Locator;
  readonly changePasswordButton: Locator;
  readonly alerts: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    const body = page.locator('body');
    this.title = page.getByTestId('page-title');
    this.firstName = new FormField(body, 'First name');
    this.lastName = new FormField(body, 'Last name');
    this.email = new FormField(body, 'Email address');
    this.phone = new FormField(body, 'Phone');
    this.street = new FormField(body, 'Street');
    this.postalCode = new FormField(body, 'Postal code');
    this.city = new FormField(body, 'City');
    this.state = new FormField(body, 'State');
    this.country = new FormField(body, 'Country');
    this.updateProfileButton = page.getByRole('button', { name: 'Update Profile' });
    this.changePasswordButton = page.getByTestId('change-password-submit');
    this.alerts = page.getByRole('alert');
  }

  @step('Open my profile')
  async open(): Promise<void> {
    await this.shell.goto('/account/profile');
  }

  @step('Update my profile')
  async update(): Promise<void> {
    await this.updateProfileButton.click();
  }
}

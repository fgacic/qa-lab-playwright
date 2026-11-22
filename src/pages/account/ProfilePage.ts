import type { Locator, Page } from '@playwright/test';
import { FormField } from '@components/FormField';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

/** What the profile says when it is saved with a field wrong (the wording is the shop's). */
export const PROFILE_FORM_INVALID = 'Please correct the highlighted fields before saving.';

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
  readonly currentPassword: Locator;
  readonly newPassword: Locator;
  readonly confirmNewPassword: Locator;
  readonly changePasswordButton: Locator;
  readonly alerts: Locator;
  /** The two-factor QR widget: a custom element with no role, name or test id. */
  readonly qrCode: Locator;

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
    this.currentPassword = page.getByRole('textbox', { name: 'Current Password' });
    this.newPassword = page.getByRole('textbox', { name: 'New Password', exact: true });
    this.confirmNewPassword = page.getByRole('textbox', { name: 'Confirm New Password' });
    this.changePasswordButton = page.getByRole('button', { name: 'Change Password' });
    this.alerts = page.getByRole('alert');
    // CSS: the TOTP QR code is a custom <qrcode> element with no role, label or test id.
    this.qrCode = page.locator('qrcode');
  }

  /** The alert that says `text` (a string or a pattern), so a spec names the message and not the filter. */
  alert(text: string | RegExp): Locator {
    return this.alerts.filter({ hasText: text });
  }

  @step('Open my profile')
  async open(): Promise<void> {
    await this.shell.goto('/account/profile');
  }

  @step('Change my password')
  async changePassword(current: string, next: string, confirmation = next): Promise<void> {
    await this.currentPassword.fill(current);
    await this.newPassword.fill(next);
    await this.confirmNewPassword.fill(confirmation);
    await this.changePasswordButton.click();
  }

  @step('Update my profile')
  async update(): Promise<void> {
    await this.updateProfileButton.click();
  }
}

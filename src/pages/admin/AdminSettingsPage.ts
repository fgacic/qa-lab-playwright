import type { Locator, Page } from '@playwright/test';
import { storedToken } from '@support/session';
import { step } from '@support/step';
import { AppShell } from '../AppShell';
import { ADMIN_SECTION_PATHS } from './admin-sections';
import { ADMIN_MESSAGES } from './alerts';

export class AdminSettingsPage {
  readonly shell: AppShell;
  readonly paymentEndpoint: Locator;
  readonly retrieveGeolocation: Locator;
  readonly co2Features: Locator;
  readonly ecoBadge: Locator;
  readonly saveButton: Locator;
  readonly clearStorageButton: Locator;
  /** What the page says after Save: the "Settings saved!" confirmation (plain text, no role) or an error alert. */
  readonly feedback: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.paymentEndpoint = page.getByRole('textbox', { name: 'Payment endpoint' });
    this.retrieveGeolocation = page.getByRole('checkbox', { name: 'Retrieve geolocation' });
    this.co2Features = page.getByRole('checkbox', { name: 'Display CO₂ sustainability features' });
    this.ecoBadge = page.getByRole('checkbox', { name: 'Display eco-friendly badge' });
    this.saveButton = page.getByRole('button', { name: 'Save', exact: true });
    this.clearStorageButton = page.getByRole('button', { name: 'Clear storage' });
    this.feedback = page.getByRole('alert').or(page.getByText(ADMIN_MESSAGES.settingsSaved));
  }

  @step('Open the settings')
  async open(): Promise<void> {
    await this.shell.goto(ADMIN_SECTION_PATHS.Settings);
  }

  @step('Save the settings')
  async save(): Promise<void> {
    await this.saveButton.click();
  }

  /** Switches one setting off and saves: the sequence the shop-facing journeys share (the spec asserts the confirmation). */
  @step('Switch the setting off and save')
  async switchOff(setting: Locator): Promise<void> {
    await setting.uncheck();
    await this.saveButton.click();
  }

  @step('Reload the settings')
  async reload(): Promise<void> {
    await this.page.reload();
  }

  @step('Clear the stored settings')
  async clearStorage(): Promise<void> {
    await this.clearStorageButton.click();
  }

  /** Whether the admin's session token is still in the browser (Clear storage must not sign the admin out); callers read it through `expect.poll`. */
  async isSignedIn(): Promise<boolean> {
    return (await storedToken(this.page)) !== null;
  }

  /** The settings live in localStorage; reading them back is how a save is verified (callers read it through `expect.poll`). */
  storedSetting(key: 'PAYMENT_ENDPOINT' | 'ECO_BADGE_ENABLED' | 'RETRIEVE_GEOLOCATION'): Promise<string | null> {
    return this.page.evaluate((k) => localStorage.getItem(k), key);
  }
}

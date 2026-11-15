import type { Locator, Page } from '@playwright/test';

/** /privacy: reached from the footer. */
export class PrivacyPage {
  readonly heading: Locator;

  constructor(page: Page) {
    this.heading = page.getByRole('heading', { name: 'Privacy Policy for Toolshop' });
  }
}

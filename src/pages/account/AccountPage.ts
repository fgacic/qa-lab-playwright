import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from '../AppShell';

export type AccountSection = 'Favorites' | 'Profile' | 'Invoices' | 'Messages';

/** /account: the signed-in landing page with one tile per section. */
export class AccountPage {
  readonly shell: AppShell;
  readonly title: Locator;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
    this.title = page.getByTestId('page-title');
  }

  get header() {
    return this.shell.header;
  }

  sectionLink(name: AccountSection): Locator {
    return this.page.getByTestId(`nav-${name.toLowerCase()}`);
  }

  @step('Open the account page')
  async open(): Promise<void> {
    await this.shell.goto('/account');
  }

  @step('Open the account section "{0}"')
  async openSection(name: AccountSection): Promise<void> {
    await this.sectionLink(name).click();
  }
}

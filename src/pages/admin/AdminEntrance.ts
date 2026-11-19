import type { Page } from '@playwright/test';
import { step } from '@support/step';
import { AppShell } from '../AppShell';
import { ADMIN_SECTION_PATHS } from './admin-sections';

/** The door of the back office: it goes to any admin address without waiting for the data behind it, for a visitor who may be turned away before the page asks for any. */
export class AdminEntrance {
  readonly shell: AppShell;

  constructor(readonly page: Page) {
    this.shell = new AppShell(page);
  }

  @step('Try to open {0}')
  async tryToOpen(address: string = ADMIN_SECTION_PATHS.Dashboard): Promise<void> {
    await this.shell.goto(address);
  }
}

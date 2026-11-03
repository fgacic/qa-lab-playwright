import type { Locator } from '@playwright/test';
import { step } from '@support/step';

export const LANGUAGES = ['de', 'el', 'en', 'es', 'fr', 'nl', 'tr'] as const;
export type Language = (typeof LANGUAGES)[number];

export class LanguageSwitcher {
  readonly button: Locator;
  readonly menu: Locator;

  constructor(root: Locator) {
    this.button = root.getByRole('button', { name: 'Select language' });
    this.menu = root.getByRole('menu', { name: 'Select language' });
  }

  option(language: Language): Locator {
    return this.menu.getByRole('menuitem', { name: language.toUpperCase(), exact: true });
  }

  @step('Switch the language to {0}')
  async switchTo(language: Language): Promise<void> {
    await this.button.click();
    await this.option(language).click();
  }
}

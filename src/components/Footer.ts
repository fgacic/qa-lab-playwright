import type { Locator } from '@playwright/test';
import { step } from '@support/step';

export class Footer {
  readonly coursesLink: Locator;
  readonly apiSpectorLink: Locator;
  readonly githubLink: Locator;
  readonly privacyPolicyLink: Locator;

  constructor(root: Locator) {
    this.coursesLink = root.getByRole('link', { name: /^Learn Test Automation/ });
    this.apiSpectorLink = root.getByRole('link', { name: /^API Spector/ });
    this.githubLink = root.getByRole('link', { name: /^GitHub/ });
    this.privacyPolicyLink = root.getByRole('link', { name: 'Privacy Policy' });
  }

  @step('Open the privacy policy')
  async openPrivacyPolicy(): Promise<void> {
    await this.privacyPolicyLink.click();
  }
}

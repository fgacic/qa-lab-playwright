import type { Locator, Page } from '@playwright/test';
import { step } from '@support/step';

/** The documentation notice, the testing-practice bar and the course promo above the shop. */
export class PromoBanners {
  readonly documentationLink: Locator;
  readonly testingGuideButton: Locator;
  readonly bugHuntingButton: Locator;
  readonly coursePromoLink: Locator;
  readonly guide: Locator;
  readonly guideNext: Locator;
  readonly guidePrevious: Locator;
  readonly guideProgress: Locator;

  constructor(page: Page) {
    this.documentationLink = page.getByRole('link', { name: 'Documentation' });
    this.testingGuideButton = page.getByRole('button', { name: 'Testing Guide' });
    this.bugHuntingButton = page.getByRole('button', { name: /Bug Hunting/ });
    this.coursePromoLink = page.getByRole('link', { name: 'Explore courses' });
    // The guide opens as a split-screen panel with no landmark role; its heading identifies it.
    this.guide = page.getByRole('heading', { name: '📋 Testing Guide', level: 1 });
    this.guideNext = page.getByRole('button', { name: 'Next →' });
    this.guidePrevious = page.getByRole('button', { name: '← Previous' });
    this.guideProgress = page.getByText(/^Step \d+ of \d+$/);
  }

  @step('Open the testing guide')
  async openTestingGuide(): Promise<void> {
    await this.testingGuideButton.click();
  }
}

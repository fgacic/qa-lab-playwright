import { expect, type Locator, type Page } from '@playwright/test';
import { step } from '@support/step';

/** The documentation notice, the testing-practice bar and the course promo above the shop. */
export class PromoBanners {
  readonly documentationLink: Locator;
  readonly testingGuideButton: Locator;
  readonly coursePromoLink: Locator;
  readonly guide: Locator;
  readonly guideNext: Locator;
  readonly guidePrevious: Locator;
  readonly guideProgress: Locator;

  constructor(private readonly page: Page) {
    this.documentationLink = page.getByRole('link', { name: 'Documentation' });
    this.testingGuideButton = page.getByRole('button', { name: 'Testing Guide' });
    this.coursePromoLink = page.getByRole('link', { name: 'Explore courses' });
    // The guide opens as a split-screen panel with no landmark role; its heading identifies it.
    this.guide = page.getByRole('heading', { name: '📋 Testing Guide', level: 1 });
    this.guideNext = page.getByRole('button', { name: 'Next →' });
    this.guidePrevious = page.getByRole('button', { name: '← Previous' });
    this.guideProgress = page.getByText(/^Step \d+ of \d+$/);
  }

  /** The guide's progress line when it shows step `n`. */
  guideStep(n: number): Locator {
    return this.page.getByText(new RegExp(`^Step ${n} of \\d+$`));
  }

  /** How many steps the guide has, read from its progress line. */
  async guideStepCount(): Promise<number> {
    // Waits for the progress line to say it ("Step 1 of 5") before reading: the total is fixed once it is drawn.
    await expect(this.guideProgress).toHaveText(/of \d+$/);
    const count = /of (\d+)$/.exec((await this.guideProgress.textContent()) ?? '')?.[1];
    return Number(count);
  }

  @step('Open the testing guide')
  async openTestingGuide(): Promise<void> {
    await this.testingGuideButton.click();
  }
}

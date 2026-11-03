import type { Locator } from '@playwright/test';

/** "Cart 1 · Sign in 2 · Billing Address 3 · Payment 4" above every checkout step. */
export class StepIndicator {
  readonly steps: Locator;

  constructor(root: Locator) {
    this.steps = root.getByRole('listitem').filter({ hasText: /^\s*(Cart|Sign in|Billing Address|Payment)\s*\d\s*$/i });
  }
}

import type { Locator } from '@playwright/test';

/** The four steps, in the order the wizard shows them. */
export const CHECKOUT_STEPS = ['Cart', 'Sign in', 'Billing Address', 'Payment'] as const;

/** "Cart 1 · Sign in 2 · Billing Address 3 · Payment 4" above every checkout step. */
export class StepIndicator {
  readonly steps: Locator;

  constructor(root: Locator) {
    this.steps = root.getByRole('listitem').filter({ hasText: new RegExp(`^\\s*(${CHECKOUT_STEPS.join('|')})\\s*\\d\\s*$`, 'i') });
  }
}

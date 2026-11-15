import { expect, type Locator, type Page } from '@playwright/test';
import { BillingStep } from './BillingStep';
import { CartStep } from './CartStep';
import { PaymentStep } from './PaymentStep';
import { SignInStep } from './SignInStep';
import { StepIndicator } from './StepIndicator';

/**
 * The four-step checkout at /checkout. All steps live in the DOM at once and only the active
 * one is visible, which is why every step locator is role-based (roles skip hidden elements).
 */
export class CheckoutWizard {
  readonly indicator: StepIndicator;
  readonly cart: CartStep;
  readonly signIn: SignInStep;
  readonly billing: BillingStep;
  readonly payment: PaymentStep;
  readonly confirmation: Locator;

  constructor(page: Page) {
    const root = page.locator('body');
    this.indicator = new StepIndicator(root);
    this.cart = new CartStep(root);
    this.signIn = new SignInStep(root);
    this.billing = new BillingStep(root);
    this.payment = new PaymentStep(root);
    this.confirmation = root.getByText(/^Thanks for your order! Your invoice number is INV-\d+\.$/);
  }

  async invoiceNumber(): Promise<string> {
    await expect(this.confirmation).toHaveText(/INV-\d+/);
    const found = /INV-\d+/.exec(await this.confirmation.innerText());
    if (!found) throw new Error('The confirmation names no invoice number');
    return found[0];
  }
}

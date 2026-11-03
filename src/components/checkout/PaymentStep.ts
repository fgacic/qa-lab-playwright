import type { Locator } from '@playwright/test';
import { step } from '@support/step';

export const PAYMENT_METHODS = {
  'bank-transfer': 'Bank Transfer',
  'cash-on-delivery': 'Cash on Delivery',
  'credit-card': 'Credit Card',
  'buy-now-pay-later': 'Buy Now Pay Later',
  'gift-card': 'Gift Card',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

/**
 * Step 4. One button does two jobs: "Check payment" (POST /payment/check), then, once the
 * check passed, "Confirm" (POST /invoices or /invoices/guest).
 */
export class PaymentStep {
  readonly heading: Locator;
  readonly method: Locator;
  readonly checkPaymentButton: Locator;
  readonly confirmButton: Locator;
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(private readonly root: Locator) {
    this.heading = root.getByRole('heading', { name: 'Payment', exact: true });
    this.method = root.getByRole('combobox', { name: 'Payment Method' });
    this.checkPaymentButton = root.getByRole('button', { name: 'Check payment' });
    this.confirmButton = root.getByRole('button', { name: 'Confirm' });
    this.successMessage = root.getByTestId('payment-success-message');
    this.errorMessage = root.getByTestId('payment-error-message');
  }

  /** The method-specific inputs, by their visible label. */
  field(label: string): Locator {
    return this.root.getByLabel(label, { exact: true });
  }

  /** Validation messages have no test id or role, so they are found by their text. */
  validationMessage(text: string): Locator {
    return this.root.getByText(text, { exact: true });
  }

  @step('Choose "{0}" as payment method')
  async choose(method: PaymentMethod): Promise<void> {
    await this.method.selectOption(method);
  }

  @step('Check the payment')
  async checkPayment(): Promise<void> {
    await this.checkPaymentButton.click();
  }

  @step('Confirm the order')
  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  /** For methods that need no financial details: choose, check, confirm. */
  @step('Pay with {0}')
  async payWith(method: Extract<PaymentMethod, 'cash-on-delivery'>): Promise<void> {
    await this.choose(method);
    await this.checkPayment();
    await this.confirmButton.waitFor();
    await this.confirm();
  }
}

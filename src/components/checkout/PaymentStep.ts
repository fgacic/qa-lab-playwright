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

/** The labels of the method-specific inputs, word for word. */
export const PAYMENT_FIELDS = {
  bankName: 'Bank Name',
  accountName: 'Account Name',
  accountNumber: 'Account Number',
  cardNumber: 'Credit Card Number',
  expirationDate: 'Expiration Date',
  cvv: 'CVV',
  cardHolder: 'Card Holder Name',
  instalments: 'Monthly Installments',
  giftCardNumber: 'Gift Card Number',
  validationCode: 'Validation Code',
} as const;

/** What the step says about an input it refuses, and about a check it could not pass. */
export const PAYMENT_MESSAGES = {
  accountNumber: 'Account number must be numeric.',
  cardNumber: 'Invalid card number format.',
  expirationDate: 'Invalid date format. Use MM/YYYY.',
  cvv: 'CVV must be 3 or 4 digits.',
  giftCardNumber: 'Please enter a valid gift card number: exactly 16 letters and/or digits.',
  validationCode: 'Please enter a valid validation code: exactly 4 letters and/or digits.',
  declined: 'Payment declined',
  unknownError: 'Unknown error',
} as const;

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
    this.checkPaymentButton = root.getByRole('button', { name: 'Check payment', exact: true });
    this.confirmButton = root.getByRole('button', { name: 'Confirm', exact: true });
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

  /** The one method that needs no financial details: choose it, check, confirm. */
  @step('Pay cash on delivery')
  async payOnDelivery(): Promise<void> {
    await this.choose('cash-on-delivery');
    await this.checkPayment();
    await this.confirm();
  }
}

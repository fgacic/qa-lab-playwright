import { PAYMENT_METHODS } from '@components/checkout/PaymentStep';
import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { IS_SELF_HOSTED } from '@support/env';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * Safety rule for this file: no card, bank-account or gift-card number is ever typed, not
 * even a fake one. Validation is triggered with obvious non-numeric junk ("abc") instead.
 */
test.describe('Checkout: payment step', () => {
  test.beforeEach(async ({ checkout }) => {
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
    await checkout.billing.enterAddress(fakeAddress());
    await checkout.billing.proceed();
  });

  test('offers the five payment methods', async ({ checkout }) => {
    await expect(checkout.payment.method.getByRole('option')).toHaveText(['Choose your payment method', ...Object.values(PAYMENT_METHODS)]);
    await expect(checkout.payment.checkPaymentButton).toBeDisabled();
  });

  const fields = {
    'bank-transfer': ['Bank Name', 'Account Name', 'Account Number'],
    'credit-card': ['Credit Card Number', 'Expiration Date', 'CVV', 'Card Holder Name'],
    'buy-now-pay-later': ['Monthly Installments'],
    'gift-card': ['Gift Card Number', 'Validation Code'],
  } as const;

  for (const [method, labels] of Object.entries(fields)) {
    test(`${PAYMENT_METHODS[method as keyof typeof fields]} asks for ${labels.join(', ')}`, async ({ checkout }) => {
      await checkout.payment.choose(method as keyof typeof fields);

      for (const label of labels) await expect(checkout.payment.field(label)).toBeVisible();
    });
  }

  test('Cash on Delivery needs no details and passes the payment check', async ({ checkout }) => {
    await checkout.payment.choose('cash-on-delivery');
    await checkout.payment.checkPayment();

    await expect(checkout.payment.successMessage).toHaveText('Payment was successful');
    await expect(checkout.payment.confirmButton).toBeEnabled();
  });

  test('Buy Now Pay Later can be checked once an instalment plan is chosen', async ({ checkout }) => {
    const { payment } = checkout;
    await payment.choose('buy-now-pay-later');
    // The pinned build enables the check before a plan is chosen; the live deployment does not.
    if (IS_SELF_HOSTED) knownBug('BUG-29', 'Buy Now Pay Later: "Check payment" is enabled before an instalment plan is chosen, and checking then answers "Unknown error" (self-hosted build; live disables it).');
    await expect(payment.checkPaymentButton).toBeDisabled({ timeout: 5_000 });

    await payment.field('Monthly Installments').selectOption('6');

    await expect(payment.checkPaymentButton).toBeEnabled();
    await expect(payment.field('Monthly Installments').getByRole('option')).toHaveText(['Choose your monthly installments', '3 Monthly Installments', '6 Monthly Installments', '9 Monthly Installments', '12 Monthly Installments']);
  });

  const junk = {
    'bank-transfer': { 'Account Number': 'Account number must be numeric.' },
    'credit-card': {
      'Credit Card Number': 'Invalid card number format.',
      'Expiration Date': 'Invalid date format. Use MM/YYYY.',
      CVV: 'CVV must be 3 or 4 digits.',
    },
    'gift-card': {
      'Gift Card Number': 'Please enter a valid gift card number: exactly 16 letters and/or digits.',
      'Validation Code': 'Please enter a valid validation code: exactly 4 letters and/or digits.',
    },
  } as const;

  for (const [method, messages] of Object.entries(junk)) {
    test(`${PAYMENT_METHODS[method as keyof typeof junk]} rejects non-numeric junk and blocks the check`, { tag: ['@negative'] }, async ({ checkout }) => {
      const { payment } = checkout;
      await payment.choose(method as keyof typeof junk);

      for (const [label, message] of Object.entries(messages)) {
        await payment.field(label).fill('abc');
        await payment.field(label).blur();
        await expect(payment.validationMessage(message)).toBeVisible();
      }
      await expect(payment.checkPaymentButton).toBeDisabled();
    });
  }

  test('Credit Card cannot be checked while its fields are empty', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
    knownBug('BUG-16', 'with Credit Card chosen and every field empty, "Check payment" is enabled.');
    await checkout.payment.choose('credit-card');
    await expect(checkout.payment.field('Credit Card Number')).toBeEmpty();

    await expect(checkout.payment.checkPaymentButton).toBeDisabled({ timeout: 5_000 });
  });

  test.describe('when the payment check is declined', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/payment/check', 400, { error: 'Payment declined' })));

    test('the reason is shown and the order cannot be confirmed', async ({ checkout }) => {
      await checkout.payment.choose('cash-on-delivery');
      await checkout.payment.checkPayment();

      await expect(checkout.payment.errorMessage).toHaveText('Payment declined');
      await expect(checkout.payment.confirmButton).toBeHidden();
    });
  });

  test.describe('when the payment check fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/payment/check', 500)));

    test('a generic error is shown and the order cannot be confirmed', async ({ checkout }) => {
      await checkout.payment.choose('cash-on-delivery');
      await checkout.payment.checkPayment();

      await expect(checkout.payment.errorMessage).toHaveText('Unknown error');
      await expect(checkout.payment.confirmButton).toBeHidden();
    });
  });

  const orderFailures = [
    { status: 500, json: { message: 'Server Error' } },
    { status: 422, json: { message: 'The billing_country does not match the entered address. The city does not belong to the selected country.' } },
  ];
  for (const { status, json } of orderFailures) {
    test.describe(`when placing the order answers ${status}`, { tag: ['@mocked', '@bug'] }, () => {
      test.use(withMocks(mock.fail('POST', '/invoices/guest', status, json)));

      test('the shopper is told the order was not placed', async ({ checkout }) => {
        knownBug('BUG-17', 'a rejected order leaves "Payment was successful" on screen with no error, so the shopper cannot tell it failed.');
        await checkout.payment.payWith('cash-on-delivery');
        await expect(checkout.wizard.confirmation).toBeHidden();

        await expect(checkout.shell.errorAlert.or(checkout.payment.errorMessage)).toBeVisible({ timeout: 5_000 });
      });
    });
  }
});

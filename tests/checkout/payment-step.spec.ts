import { PAYMENT_METHODS } from '@components/checkout/PaymentStep';
import { expect, mock, test, withMocks } from '@fixtures';
import { postcodeLookupMock } from '@fixtures/pages';
import { knownBug } from '@support/known-bug';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * Safety rule for this file: no card, bank-account or gift-card number is ever typed, not
 * even a fake one. Validation is triggered with obvious junk (punctuation of the right length)
 * instead, so no field here is ever filled with a value that could pass for a real number.
 */
/** Labels the specs use more than once. */
const FIELD = { instalments: 'Monthly Installments', accountNumber: 'Account Number' } as const;

/** `length` characters that are neither digits nor letters. */
const junkOf = (length: number) => '!'.repeat(length);

/** What the payment check answers when it passes, and the mock of it. */
const PAYMENT_PASSED = { message: 'Payment was successful' };
const paymentPasses = mock.respond('POST', '/payment/check', PAYMENT_PASSED);

test.describe('Checkout: payment step', () => {
  // None of these is about the postcode lookup, so it is answered by a mock: an outage of the real
  // one cannot fail a payment test. (A describe with mocks of its own lists this one again.)
  test.use(withMocks(postcodeLookupMock));

  test.beforeEach(async ({ checkout }) => {
    await checkout.proceedToPayment(fakeGuest(), fakeAddress());
  });

  test('offers the five payment methods', async ({ checkout }) => {
    await expect(checkout.payment.method.getByRole('option')).toHaveText(['Choose your payment method', ...Object.values(PAYMENT_METHODS)]);
    await expect(checkout.payment.checkPaymentButton).toBeDisabled();
  });

  const fields = {
    'bank-transfer': ['Bank Name', 'Account Name', FIELD.accountNumber],
    'credit-card': ['Credit Card Number', 'Expiration Date', 'CVV', 'Card Holder Name'],
    'buy-now-pay-later': [FIELD.instalments],
    'gift-card': ['Gift Card Number', 'Validation Code'],
  } as const;

  for (const [method, labels] of Object.entries(fields)) {
    test(`${PAYMENT_METHODS[method as keyof typeof fields]} asks for ${labels.join(', ')}`, async ({ checkout }) => {
      await checkout.payment.choose(method as keyof typeof fields);

      for (const label of labels) await expect(checkout.payment.field(label)).toBeVisible();
    });
  }

  // The real check is a POST the live guard refuses, so it runs on the self-hosted shop only; the
  // mocked twin proves the same page behaviour everywhere.
  test('Cash on Delivery needs no details and passes the payment check (real shop)', { tag: ['@self-hosted'] }, async ({ checkout }) => {
    await checkout.payment.choose('cash-on-delivery');
    await checkout.payment.checkPayment();

    await expect(checkout.payment.successMessage).toHaveText(PAYMENT_PASSED.message);
    await expect(checkout.payment.confirmButton).toBeEnabled();
  });

  test.describe('when the payment check passes', { tag: ['@mocked', '@smoke'] }, () => {
    test.use({ ...withMocks(postcodeLookupMock, paymentPasses), refuseUnmockedWrites: true });

    test('Cash on Delivery needs no details and passes the payment check (mocked)', async ({ checkout }) => {
      await checkout.payment.choose('cash-on-delivery');
      await checkout.payment.checkPayment();

      await expect(checkout.payment.successMessage).toHaveText(PAYMENT_PASSED.message);
      await expect(checkout.payment.confirmButton).toBeEnabled();
    });
  });

  test('Buy Now Pay Later offers instalment plans of 3, 6, 9 and 12 months', async ({ checkout }) => {
    const { payment } = checkout;
    await payment.choose('buy-now-pay-later');

    await payment.field(FIELD.instalments).selectOption('6');

    await expect(payment.checkPaymentButton).toBeEnabled();
    await expect(payment.field(FIELD.instalments).getByRole('option')).toHaveText(['Choose your monthly installments', '3 Monthly Installments', '6 Monthly Installments', '9 Monthly Installments', '12 Monthly Installments']);
  });

  // The pinned build enables the check before a plan is chosen; the live deployment does not,
  // so the pin is scheduled on the self-hosted target only.
  test('Buy Now Pay Later cannot be checked before an instalment plan is chosen', { tag: ['@negative', '@bug', '@self-hosted'] }, async ({ checkout }) => {
    knownBug('BUG-29', 'Buy Now Pay Later: "Check payment" is enabled before an instalment plan is chosen, and checking then answers "Unknown error" (self-hosted build; live disables it).');
    await checkout.payment.choose('buy-now-pay-later');
    await expect(checkout.payment.field(FIELD.instalments)).toHaveValue('');

    await expect(checkout.payment.checkPaymentButton, 'BUG-29: Check payment stays disabled until a plan is chosen').toBeDisabled({ timeout: 5_000 });
  });

  // Each value is as long as its field wants, so it is the characters that are refused, not the length.
  const junk = {
    'bank-transfer': { [FIELD.accountNumber]: { value: junkOf(8), message: 'Account number must be numeric.' } },
    'credit-card': {
      'Credit Card Number': { value: junkOf(16), message: 'Invalid card number format.' },
      'Expiration Date': { value: junkOf(7), message: 'Invalid date format. Use MM/YYYY.' },
      CVV: { value: junkOf(3), message: 'CVV must be 3 or 4 digits.' },
    },
    'gift-card': {
      'Gift Card Number': { value: junkOf(16), message: 'Please enter a valid gift card number: exactly 16 letters and/or digits.' },
      'Validation Code': { value: junkOf(4), message: 'Please enter a valid validation code: exactly 4 letters and/or digits.' },
    },
  } as const;

  for (const [method, fieldsAndMessages] of Object.entries(junk)) {
    test(`${PAYMENT_METHODS[method as keyof typeof junk]} rejects characters that are not digits or letters and blocks the check`, { tag: ['@negative'] }, async ({ checkout }) => {
      const { payment } = checkout;
      await payment.choose(method as keyof typeof junk);

      for (const [label, { value, message }] of Object.entries(fieldsAndMessages)) {
        await payment.field(label).fill(value);
        await payment.field(label).blur();
        await expect(payment.validationMessage(message)).toBeVisible();
      }
      await expect(payment.checkPaymentButton).toBeDisabled();
    });
  }

  test('Bank Transfer with every field valid except the account number blocks the check', { tag: ['@negative'] }, async ({ checkout }) => {
    // The bank and account names are plain text, so they can be filled for real; only the number is junk.
    // That leaves the junk number as the one thing that can keep the button disabled.
    const { payment } = checkout;
    await payment.choose('bank-transfer');
    await payment.field('Bank Name').fill('QA Lab Bank');
    await payment.field('Account Name').fill('QA Lab');

    await payment.field(FIELD.accountNumber).fill(junkOf(8));
    await payment.field(FIELD.accountNumber).blur();

    await expect(payment.validationMessage('Account number must be numeric.')).toBeVisible();
    await expect(payment.checkPaymentButton).toBeDisabled();
  });

  test('Credit Card cannot be checked while its fields are empty', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
    knownBug('BUG-16', 'with Credit Card chosen and every field empty, "Check payment" is enabled.');
    await checkout.payment.choose('credit-card');
    await expect(checkout.payment.field('Credit Card Number')).toBeEmpty();

    await expect(checkout.payment.checkPaymentButton, 'BUG-16: Check payment stays disabled while every card field is empty').toBeDisabled({ timeout: 5_000 });
  });

  test.describe('when the payment check is declined', { tag: ['@mocked'] }, () => {
    test.use({ ...withMocks(postcodeLookupMock, mock.fail('POST', '/payment/check', 400, { error: 'Payment declined' })), refuseUnmockedWrites: true });

    test('the reason is shown and the order cannot be confirmed', async ({ checkout }) => {
      await checkout.payment.choose('cash-on-delivery');
      await checkout.payment.checkPayment();

      await expect(checkout.payment.errorMessage).toHaveText('Payment declined');
      await expect(checkout.payment.confirmButton).toBeHidden();
    });
  });

  test.describe('when the payment check fails', { tag: ['@mocked'] }, () => {
    test.use({ ...withMocks(postcodeLookupMock, mock.fail('POST', '/payment/check', 500)), refuseUnmockedWrites: true });

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
      // The check is answered by a mock and so is the order (refused): no real write can happen.
      test.use({ ...withMocks(postcodeLookupMock, paymentPasses, mock.fail('POST', '/invoices/guest', status, json)), refuseUnmockedWrites: true });

      test('the shopper is told the order was not placed', async ({ checkout }) => {
        knownBug('BUG-17', 'a rejected order leaves "Payment was successful" on screen with no error, so the shopper cannot tell it failed.');
        // A write no mock answers (a gap in the mocks) fails the test at teardown, see fixtures/mocks.ts.
        await checkout.payment.payOnDelivery();

        await expect(checkout.wizard.confirmation, 'BUG-17: a rejected order is not confirmed').toBeHidden();
        await expect(checkout.shell.errorAlert.or(checkout.payment.errorMessage), 'BUG-17: the shopper is told the order failed').toBeVisible({ timeout: 5_000 });
      });
    });
  }
});

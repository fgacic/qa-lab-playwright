import { PAYMENT_FIELDS as FIELD, PAYMENT_MESSAGES, PAYMENT_METHODS } from '@components/checkout/PaymentStep';
import { expect, mock, test, withMocks } from '@fixtures';
import { postcodeLookupMock } from '@fixtures/pages';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeAddress, fakeGuest } from '@support/test-data';

/**
 * Safety rule for this file: no card, bank-account or gift-card number is ever typed, not
 * even a fake one. Validation is triggered with obvious junk (punctuation of the right length)
 * instead, so no field here is ever filled with a value that could pass for a real number.
 */
/** Plain text the specs type into the fields that take any text, so a junk value elsewhere is the only thing left to refuse. */
const PLAIN_TEXT = 'QA Lab';
/** The instalment plan the passing BNPL check chooses. */
const INSTALMENT_PLAN = '6';

/** `length` characters that are neither digits nor letters. */
const junkOf = (length: number) => '!'.repeat(length);

/** What the payment check answers when it passes, and the mock of it. */
const PAYMENT_PASSED = { message: 'Payment was successful' };
const paymentPasses = mock.respond('POST', '/payment/check', PAYMENT_PASSED);

/** What the shop answers an accepted guest order with (201), as far as the page reads it. */
/** The cart itself: once an order is placed the page deletes it (answered here, so the real cart is untouched). */
const CART = /^\/carts\/[^/]+$/;
const ORDER_ACCEPTED = { id: '01QALABFAKEINVOICE0000000', invoice_number: 'INV-2026999998' };

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
    'bank-transfer': [FIELD.bankName, FIELD.accountName, FIELD.accountNumber],
    'credit-card': [FIELD.cardNumber, FIELD.expirationDate, FIELD.cvv, FIELD.cardHolder],
    'buy-now-pay-later': [FIELD.instalments],
    'gift-card': [FIELD.giftCardNumber, FIELD.validationCode],
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

    await payment.field(FIELD.instalments).selectOption(INSTALMENT_PLAN);

    await expect(payment.checkPaymentButton).toBeEnabled();
    await expect(payment.field(FIELD.instalments).getByRole('option')).toHaveText(['Choose your monthly installments', '3 Monthly Installments', '6 Monthly Installments', '9 Monthly Installments', '12 Monthly Installments']);
  });

  test.describe('when the payment check passes for Buy Now Pay Later', { tag: ['@mocked'] }, () => {
    test.use({ ...withMocks(postcodeLookupMock, paymentPasses), refuseUnmockedWrites: true });

    test('a chosen instalment plan is sent with the check and the order can be confirmed', async ({ checkout, apiMock }) => {
      const { payment } = checkout;
      await payment.choose('buy-now-pay-later');
      await payment.field(FIELD.instalments).selectOption(INSTALMENT_PLAN);
      const asked = apiMock.waitForRequest('POST', '/payment/check');

      await payment.checkPayment();

      expect((await asked).postDataJSON(), 'the chosen plan travels with the check').toMatchObject({
        payment_method: 'buy-now-pay-later',
        payment_details: { monthly_installments: INSTALMENT_PLAN },
      });
      await expect(payment.successMessage).toHaveText(PAYMENT_PASSED.message);
      await expect(payment.confirmButton).toBeEnabled();
    });
  });

  // The pinned build enables the check before a plan is chosen; the live deployment does not,
  // so the pin is scheduled on the self-hosted target only.
  test('Buy Now Pay Later cannot be checked before an instalment plan is chosen', { tag: ['@negative', '@bug', '@self-hosted'] }, async ({ checkout }) => {
    knownBug('BUG-29', 'Buy Now Pay Later: "Check payment" is enabled before an instalment plan is chosen, and checking then answers "Unknown error" (self-hosted build; live disables it).');
    await checkout.payment.choose('buy-now-pay-later');
    await expect(checkout.payment.field(FIELD.instalments)).toHaveValue('');

    await expect(checkout.payment.checkPaymentButton, 'BUG-29: Check payment stays disabled until a plan is chosen').toBeDisabled({ timeout: BUG_TIMEOUT });
  });

  // Each junk value is as long as its field wants, so it is the characters that are refused, not the length.
  // `valid` fills the fields that take plain text, so the junk values are the only thing that can keep the check disabled.
  const junk = {
    'bank-transfer': {
      valid: [FIELD.bankName, FIELD.accountName],
      invalid: { [FIELD.accountNumber]: { value: junkOf(8), message: PAYMENT_MESSAGES.accountNumber } },
    },
    'credit-card': {
      valid: [FIELD.cardHolder],
      invalid: {
        [FIELD.cardNumber]: { value: junkOf(16), message: PAYMENT_MESSAGES.cardNumber },
        [FIELD.expirationDate]: { value: junkOf(7), message: PAYMENT_MESSAGES.expirationDate },
        [FIELD.cvv]: { value: junkOf(3), message: PAYMENT_MESSAGES.cvv },
      },
    },
    'gift-card': {
      valid: [],
      invalid: {
        [FIELD.giftCardNumber]: { value: junkOf(16), message: PAYMENT_MESSAGES.giftCardNumber },
        [FIELD.validationCode]: { value: junkOf(4), message: PAYMENT_MESSAGES.validationCode },
      },
    },
  } as const;

  for (const [method, { valid, invalid }] of Object.entries(junk)) {
    test(`${PAYMENT_METHODS[method as keyof typeof junk]} rejects characters that are not digits or letters and blocks the check`, { tag: ['@negative'] }, async ({ checkout }) => {
      const { payment } = checkout;
      await payment.choose(method as keyof typeof junk);
      for (const label of valid) await payment.field(label).fill(PLAIN_TEXT);

      for (const [label, { value, message }] of Object.entries(invalid)) {
        await payment.field(label).fill(value);
        await payment.field(label).blur();
        await expect(payment.validationMessage(message)).toBeVisible();
      }
      await expect(payment.checkPaymentButton).toBeDisabled();
    });
  }

  test('Credit Card cannot be checked while its fields are empty', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
    knownBug('BUG-16', 'with Credit Card chosen and every field empty, "Check payment" is enabled.');
    await checkout.payment.choose('credit-card');
    await expect(checkout.payment.field(FIELD.cardNumber)).toBeEmpty();

    await expect(checkout.payment.checkPaymentButton, 'BUG-16: Check payment stays disabled while every card field is empty').toBeDisabled({ timeout: BUG_TIMEOUT });
  });

  test.describe('when the payment check is declined', { tag: ['@mocked'] }, () => {
    test.use({ ...withMocks(postcodeLookupMock, mock.fail('POST', '/payment/check', 400, { error: PAYMENT_MESSAGES.declined })), refuseUnmockedWrites: true });

    test('the reason is shown and the order cannot be confirmed', async ({ checkout }) => {
      await checkout.payment.choose('cash-on-delivery');
      await checkout.payment.checkPayment();

      await expect(checkout.payment.errorMessage).toHaveText(PAYMENT_MESSAGES.declined);
      await expect(checkout.payment.confirmButton).toBeHidden();
    });
  });

  test.describe('when the payment check fails', { tag: ['@mocked'] }, () => {
    test.use({ ...withMocks(postcodeLookupMock, mock.fail('POST', '/payment/check', 500)), refuseUnmockedWrites: true });

    test('a generic error is shown and the order cannot be confirmed', async ({ checkout }) => {
      await checkout.payment.choose('cash-on-delivery');
      await checkout.payment.checkPayment();

      await expect(checkout.payment.errorMessage).toHaveText(PAYMENT_MESSAGES.unknownError);
      await expect(checkout.payment.confirmButton).toBeHidden();
    });
  });

  test.describe('when the order is accepted', { tag: ['@mocked'] }, () => {
    // The twin of the self-hosted order in purchase-flow: the same page behaviour on every target, with no order placed.
    test.use({ ...withMocks(postcodeLookupMock, paymentPasses, mock.respond('POST', '/invoices/guest', ORDER_ACCEPTED, 201), mock.respond('DELETE', CART, undefined, 204)), refuseUnmockedWrites: true });

    test('the confirmation names the invoice number the shop issued', async ({ checkout, apiMock }) => {
      const placed = apiMock.waitForRequest('POST', '/invoices/guest');
      const cartDropped = apiMock.waitForRequest('DELETE', CART);

      await checkout.payment.payOnDelivery();

      expect((await placed).postDataJSON(), 'the order is placed for the chosen payment method').toMatchObject({ payment_method: 'cash-on-delivery' });
      await expect(checkout.wizard.confirmation).toHaveText(`Thanks for your order! Your invoice number is ${ORDER_ACCEPTED.invoice_number}.`);
      await cartDropped;
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
        knownBug('BUG-17', 'a rejected order leaves "Payment was successful" on screen with no error, so the shopper cannot tell it failed.', { absence: true });
        // A write no mock answers (a gap in the mocks) fails the test at teardown, see fixtures/mocks.ts.
        await checkout.payment.payOnDelivery();

        await expect(checkout.wizard.confirmation, 'BUG-17: a rejected order is not confirmed').toBeHidden();
        await expect(failureFeedback(checkout.page).or(checkout.payment.errorMessage), 'BUG-17: the shopper is told the order failed').toBeVisible({ timeout: BUG_TIMEOUT });
      });
    });
  }
});

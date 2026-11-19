import { INSTALMENT_PLANS, INSTALMENT_PROMPT, instalmentOptionText, PAYMENT_FIELDS as FIELD, PAYMENT_MESSAGES, PAYMENT_METHOD_PROMPT, PAYMENT_METHODS, type PaymentMethod } from '@components/checkout/PaymentStep';
import { expect, mock, test, withMocks } from '@fixtures';
import { postcodeLookupMock } from '@fixtures/mocks';
import { holdAnswers } from '@support/answer-gate';
import { failureFeedback } from '@support/feedback';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { CART, PAYMENT_PASSED } from '@support/cart-routes';
import { acceptedGuestInvoice } from '@support/payloads';
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

/** `Object.entries` that keeps the type of the keys, so a payment method needs no cast where it is passed on. */
const entriesOf = <K extends string, V>(record: Record<K, V>): [K, V][] => Object.entries(record) as [K, V][];

/** `length` characters that are neither digits nor letters. */
const junkOf = (length: number) => '!'.repeat(length);

/** Mocks for a describe, plus the guard that makes any write they do not answer fail the test instead of reaching the shop. */
const withRefusedWrites = (...mocks: Parameters<typeof withMocks>) => ({ ...withMocks(...mocks), refuseUnmockedWrites: true });

/** The mock of the payment check passing. */
const paymentPasses = mock.respond('POST', '/payment/check', PAYMENT_PASSED);

/** Two methods the specs choose by id, typed against the page object's list so a renamed method fails to compile. */
const BUY_NOW_PAY_LATER = 'buy-now-pay-later' satisfies PaymentMethod;
const CASH_ON_DELIVERY = 'cash-on-delivery' satisfies PaymentMethod;

/** The fields each payment method asks for, by the label the shopper reads. */
const fields = {
  'bank-transfer': [FIELD.bankName, FIELD.accountName, FIELD.accountNumber],
  'credit-card': [FIELD.cardNumber, FIELD.expirationDate, FIELD.cvv, FIELD.cardHolder],
  'buy-now-pay-later': [FIELD.instalments],
  'gift-card': [FIELD.giftCardNumber, FIELD.validationCode],
} as const;

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

test.describe('Checkout: payment step', () => {
  // None of these is about the postcode lookup, so it is answered by a mock: an outage of the real
  // one cannot fail a payment test. (A describe with mocks of its own lists this one again.)
  test.use(withMocks(postcodeLookupMock));

  test.beforeEach(async ({ checkout }) => {
    await checkout.proceedToPayment(fakeGuest(), fakeAddress());
  });

  test('browser Back from the payment step leaves the checkout, and Forward returns to the cart with its lines', async ({ checkout, cartItems, page }) => {
    const [{ product }] = cartItems;

    await checkout.walkThenBackAndForward(async () => {
      await checkout.proceedToPayment(fakeGuest(), fakeAddress());
      await expect(checkout.payment.heading).toBeVisible();
    });

    await expect(page).toHaveURL(/\/checkout$/);
    await expect(checkout.cart.table.row(product.name).title, 'the cart still holds its line').toBeVisible();
    await expect(checkout.payment.heading, 'the payment step is not resumed half way').toBeHidden();
  });

  test('offers the five payment methods', async ({ checkout }) => {
    await expect(checkout.payment.method.getByRole('option')).toHaveText([PAYMENT_METHOD_PROMPT, ...Object.values(PAYMENT_METHODS)]);
    await expect(checkout.payment.checkPaymentButton).toBeDisabled();
  });

  for (const [method, labels] of entriesOf(fields)) {
    test(`${PAYMENT_METHODS[method]} asks for ${labels.join(', ')}`, async ({ checkout }) => {
      await checkout.payment.choose(method);

      // One assertion per field: the test title names them all, and the failing one is named in the error.
      for (const label of labels) await expect(checkout.payment.field(label)).toBeVisible();
    });
  }

  // The real check is a POST the live guard refuses, so it runs on the self-hosted shop only; the
  // mocked twin proves the same page behaviour everywhere.
  test('Cash on Delivery needs no details and passes the payment check (real shop)', { tag: ['@self-hosted'] }, async ({ checkout }) => {
    await checkout.payment.choose(CASH_ON_DELIVERY);
    await checkout.payment.checkPayment();

    await expect(checkout.payment.successMessage).toHaveText(PAYMENT_PASSED.message);
    await expect(checkout.payment.confirmButton).toBeEnabled();
  });

  test.describe('when the payment check passes', { tag: ['@mocked', '@smoke'] }, () => {
    test.use(withRefusedWrites(postcodeLookupMock, paymentPasses));

    test('Cash on Delivery needs no details and passes the payment check (mocked)', async ({ checkout }) => {
      await checkout.payment.choose(CASH_ON_DELIVERY);
      await checkout.payment.checkPayment();

      await expect(checkout.payment.successMessage).toHaveText(PAYMENT_PASSED.message);
      await expect(checkout.payment.confirmButton).toBeEnabled();
    });
  });

  test('Buy Now Pay Later offers instalment plans of 3, 6, 9 and 12 months', async ({ checkout }) => {
    const { payment } = checkout;
    await payment.choose(BUY_NOW_PAY_LATER);

    await payment.field(FIELD.instalments).selectOption(INSTALMENT_PLAN);

    await expect(payment.checkPaymentButton).toBeEnabled();
    await expect(payment.field(FIELD.instalments).getByRole('option')).toHaveText([INSTALMENT_PROMPT, ...INSTALMENT_PLANS.map(instalmentOptionText)]);
  });

  test.describe('when the payment check passes for Buy Now Pay Later', { tag: ['@mocked'] }, () => {
    test.use(withRefusedWrites(postcodeLookupMock, paymentPasses));

    test('a chosen instalment plan is sent with the check and the order can be confirmed', async ({ checkout, apiMock }) => {
      const { payment } = checkout;
      await payment.choose(BUY_NOW_PAY_LATER);
      await payment.field(FIELD.instalments).selectOption(INSTALMENT_PLAN);
      const asked = apiMock.waitForRequest('POST', '/payment/check');

      await payment.checkPayment();

      expect((await asked).postDataJSON(), 'the chosen plan travels with the check').toMatchObject({
        payment_method: BUY_NOW_PAY_LATER,
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
    await checkout.payment.choose(BUY_NOW_PAY_LATER);
    await expect(checkout.payment.field(FIELD.instalments)).toHaveValue('');

    await expect(checkout.payment.checkPaymentButton, 'BUG-29: Check payment stays disabled until a plan is chosen').toBeDisabled({ timeout: BUG_TIMEOUT });
  });

  for (const [method, { valid, invalid }] of entriesOf(junk)) {
    test(`${PAYMENT_METHODS[method]} rejects characters that are not digits or letters and blocks the check`, { tag: ['@negative'] }, async ({ checkout }) => {
      const { payment } = checkout;
      await payment.choose(method);
      for (const label of valid) await payment.field(label).fill(PLAIN_TEXT);

      for (const [label, { value, message }] of Object.entries(invalid)) {
        await payment.field(label).fill(value);
        await payment.field(label).blur();
        await expect(payment.validationMessage(message)).toBeVisible();
      }
      await expect(payment.checkPaymentButton).toBeDisabled();
    });
  }

  test('switching to another method and back empties the details typed for the first', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
    knownBug('BUG-52', 'the details typed for a payment method stay in the form when another method is chosen, and are still there when the shopper comes back to the first.');
    const { payment } = checkout;
    await payment.choose('gift-card');
    // Junk of the field's length, as everywhere in this file: the value only has to survive a switch of method, and no value here could pass for a card number.
    const typed = junkOf(16);
    await payment.field(FIELD.giftCardNumber).fill(typed);
    await expect(payment.field(FIELD.giftCardNumber)).toHaveValue(typed);
    await payment.choose('credit-card');

    await payment.choose('gift-card');

    await expect(payment.field(FIELD.giftCardNumber), 'BUG-52: coming back to a method finds its fields empty').toBeEmpty({ timeout: BUG_TIMEOUT });
  });

  test('Credit Card cannot be checked while its fields are empty', { tag: ['@negative', '@bug'] }, async ({ checkout }) => {
    knownBug('BUG-16', 'with Credit Card chosen and every field empty, "Check payment" is enabled.');
    await checkout.payment.choose('credit-card');
    await expect(checkout.payment.field(FIELD.cardNumber)).toBeEmpty();

    await expect(checkout.payment.checkPaymentButton, 'BUG-16: Check payment stays disabled while every card field is empty').toBeDisabled({ timeout: BUG_TIMEOUT });
  });

  test.describe('when Check payment is double-clicked', { tag: ['@mocked', '@bug'] }, () => {
    // The order is answered too: if the second click lands on Confirm, which replaces the button, no real write can happen.
    test.use(withRefusedWrites(postcodeLookupMock, paymentPasses, mock.respond('POST', '/invoices/guest', acceptedGuestInvoice, 201), mock.respond('DELETE', CART, undefined, 204)));

    test('a double click on Check payment sends one check', async ({ checkout, page }) => {
      knownBug('BUG-53', 'a double click on "Check payment" sends the check twice.');
      // Held until both clicks have landed: answered at once, the page may already have replaced the button when WebKit
      // delivers the second click, and one check would be sent whatever the page does.
      const check = await holdAnswers(page, /\/payment\/check$/, PAYMENT_PASSED, 200);
      await checkout.payment.choose(CASH_ON_DELIVERY);

      await checkout.payment.checkPaymentWithDoubleClick();
      check.release();

      await expect(checkout.payment.successMessage).toHaveText(PAYMENT_PASSED.message);
      expect(check.reached, 'BUG-53: one check is sent for one decision').toBe(1);
    });
  });

  test.describe('when the payment check is declined', { tag: ['@mocked'] }, () => {
    test.use(withRefusedWrites(postcodeLookupMock, mock.fail('POST', '/payment/check', 400, { error: PAYMENT_MESSAGES.declined })));

    test('the reason is shown and the order cannot be confirmed', async ({ checkout }) => {
      await checkout.payment.choose(CASH_ON_DELIVERY);
      await checkout.payment.checkPayment();

      await expect(checkout.payment.errorMessage).toHaveText(PAYMENT_MESSAGES.declined);
      await expect(checkout.payment.confirmButton).toBeHidden();
    });
  });

  test.describe('when the payment check fails', { tag: ['@mocked'] }, () => {
    test.use(withRefusedWrites(postcodeLookupMock, mock.fail('POST', '/payment/check', 500)));

    test('a generic error is shown and the order cannot be confirmed', async ({ checkout }) => {
      await checkout.payment.choose(CASH_ON_DELIVERY);
      await checkout.payment.checkPayment();

      await expect(checkout.payment.errorMessage).toHaveText(PAYMENT_MESSAGES.unknownError);
      await expect(checkout.payment.confirmButton).toBeHidden();
    });
  });

  test.describe('when the order is accepted', { tag: ['@mocked'] }, () => {
    // The twin of the self-hosted order in purchase-flow: the same page behaviour on every target, with no order placed.
    test.use(withRefusedWrites(postcodeLookupMock, paymentPasses, mock.respond('POST', '/invoices/guest', acceptedGuestInvoice, 201), mock.respond('DELETE', CART, undefined, 204)));

    test('the confirmation names the invoice number the shop issued', async ({ checkout, apiMock }) => {
      const placed = apiMock.waitForRequest('POST', '/invoices/guest');
      const cartDropped = apiMock.waitForRequest('DELETE', CART);

      await checkout.payment.payOnDelivery();

      expect((await placed).postDataJSON(), 'the order is placed for the chosen payment method').toMatchObject({ payment_method: CASH_ON_DELIVERY });
      await expect(checkout.wizard.confirmationFor(acceptedGuestInvoice.invoice_number)).toBeVisible();
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
      test.use(withRefusedWrites(postcodeLookupMock, paymentPasses, mock.fail('POST', '/invoices/guest', status, json)));

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

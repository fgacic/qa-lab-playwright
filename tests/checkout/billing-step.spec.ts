import { expect, mock, test, withMocks } from '@fixtures';
import { fakeAddress, fakeGuest } from '@support/test-data';

const lookupResult = { street: 'Mockstraat', house_number: '1', city: 'Mockstad', state: 'Mockland', country: 'NL', postcode: '1234 AB' };

test.describe('Checkout: billing address step', () => {
  test.beforeEach(async ({ checkout }) => {
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
  });

  test('Proceed stays disabled until every field is filled', { tag: ['@negative'] }, async ({ checkout }) => {
    const { billing } = checkout;
    await expect(billing.lookupHint).toHaveText('Enter country, postal code and house number. We will fill in the rest automatically.');
    await expect(billing.proceedButton).toBeDisabled();

    await billing.enterAddress(fakeAddress());
    await expect(billing.proceedButton).toBeEnabled();

    await billing.city.input.clear();
    await expect(billing.proceedButton).toBeDisabled();
  });

  test.describe('when the postcode lookup finds the address', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', '/postcode-lookup', lookupResult)));

    test('street, city and state are filled in', async ({ checkout }) => {
      await checkout.billing.lookUp(fakeAddress());

      await expect(checkout.billing.street.input).toHaveValue('Mockstraat');
      await expect(checkout.billing.city.input).toHaveValue('Mockstad');
      await expect(checkout.billing.state.input).toHaveValue('Mockland');
      await expect(checkout.billing.proceedButton).toBeEnabled();
    });
  });

  test.describe('when the postcode lookup finds nothing', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 404, { message: 'Address not found' })));

    test('the shopper is told and can type the address', async ({ checkout }) => {
      await checkout.billing.lookUp(fakeAddress());

      await expect(checkout.billing.lookupError).toHaveText('Address not found');
      await checkout.billing.completeAddress(fakeAddress());
      await expect(checkout.billing.proceedButton).toBeEnabled();
    });
  });

  test.describe('when the postcode lookup fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 500)));

    test('the error is shown and the address can still be typed', async ({ checkout }) => {
      await checkout.billing.lookUp(fakeAddress());

      await expect(checkout.billing.lookupError).toHaveText('Server Error');
      await checkout.billing.completeAddress(fakeAddress());
      await expect(checkout.billing.proceedButton).toBeEnabled();
    });
  });
});

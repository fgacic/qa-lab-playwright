import { expect, mock, test, withMocks } from '@fixtures';
import { POSTCODE_LOOKUP_RESULT, postcodeLookupMock } from '@fixtures/pages';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeAddress, fakeGuest } from '@support/test-data';

/** What the step tells the shopper, word for word. */
const TEXT = {
  hint: 'Enter country, postal code and house number. We will fill in the rest automatically.',
  notFound: 'Address not found',
  serverError: 'Server Error',
  postcodeInvalid: 'The postal code format is not valid for the selected country.',
} as const;

/** The two answers of the late-answer race: the slow one is for the first house number, the fast one for the second. */
const RACE = {
  first: { houseNumber: '1', answer: { ...POSTCODE_LOOKUP_RESULT, house_number: '1', street: 'Slowstraat', city: 'Slowstad' } },
  second: { houseNumber: '2', answer: { ...POSTCODE_LOOKUP_RESULT, house_number: '2', street: 'Faststraat', city: 'Faststad' } },
} as const;

/** Matches the postcode lookup asked for one house number (by its query parameter, not by a piece of the URL). */
const lookupFor = (houseNumber: string) => (r: { url(): string }) => {
  const url = new URL(r.url());
  return url.pathname.endsWith('/postcode-lookup') && url.searchParams.get('house_number') === houseNumber;
};

test.describe('Checkout: billing address step', () => {
  test.beforeEach(async ({ checkout }) => {
    await checkout.cart.proceed();
    await checkout.signIn.continueAsGuest(fakeGuest());
  });

  // The real lookup is a third-party service the shared live site may not reach: this one runs on the self-hosted shop only, and the mocked twin below holds the same page behaviour everywhere.
  test('with an address from the real postcode lookup, Proceed stays disabled while the street, the city or the state is empty', { tag: ['@negative', '@self-hosted'] }, async ({ checkout }) => {
    const { billing } = checkout;
    await expect(billing.lookupHint).toHaveText(TEXT.hint);
    await expect(billing.proceedButton).toBeDisabled();

    await billing.enterAddress(fakeAddress());
    await expect(billing.proceedButton).toBeEnabled();

    for (const field of [billing.street, billing.city, billing.state]) {
      const filled = await field.input.inputValue();
      await field.input.clear();
      await expect(billing.proceedButton).toBeDisabled();
      await field.input.fill(filled);
      await expect(billing.proceedButton).toBeEnabled();
    }
  });

  test.describe('when the postcode lookup finds the address', { tag: ['@mocked'] }, () => {
    test.use(withMocks(postcodeLookupMock));

    test('browser Back from the billing step leaves the checkout, and Forward returns to the cart with its lines', async ({ checkout, cartItems, page }) => {
      const [{ product }] = cartItems;
      // The cart opened from the shop, so there is a page to go Back to; the steps are then walked again from the cart.
      await checkout.header.goHomeViaLogo();
      await checkout.header.openCart();
      await checkout.cart.proceed();
      await checkout.signIn.continueAsGuest(fakeGuest());
      await expect(checkout.billing.heading).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL('/');
      await page.goForward();

      await expect(page).toHaveURL(/\/checkout$/);
      await expect(checkout.cart.table.row(product.name).title, 'the cart still holds its line').toBeVisible();
      await expect(checkout.billing.heading, 'the billing step is not resumed half way').toBeHidden();
    });

    test('street, city and state are filled in', async ({ checkout }) => {
      const { status } = await checkout.billing.lookUp(fakeAddress());

      expect(status, 'the lookup finds the address').toBe(200);
      await expect(checkout.billing.street.input).toHaveValue(POSTCODE_LOOKUP_RESULT.street);
      await expect(checkout.billing.city.input).toHaveValue(POSTCODE_LOOKUP_RESULT.city);
      await expect(checkout.billing.state.input).toHaveValue(POSTCODE_LOOKUP_RESULT.state);
      await expect(checkout.billing.proceedButton).toBeEnabled();
    });

    test('an empty house number keeps Proceed disabled', { tag: ['@negative'] }, async ({ checkout }) => {
      await checkout.billing.enterAddress(fakeAddress());
      await expect(checkout.billing.proceedButton).toBeEnabled();

      await checkout.billing.houseNumber.input.clear();

      await expect(checkout.billing.proceedButton).toBeDisabled();
    });

    test('changing the country after filling the address asks the lookup again and shows its answer', async ({ checkout, apiMock }) => {
      const { billing } = checkout;
      await billing.enterAddress(fakeAddress());

      // The lookup now refuses the postcode for the new country: the page shows why.
      await apiMock.use(mock.fail('GET', '/postcode-lookup', 422, { message: TEXT.postcodeInvalid }));
      const refused = apiMock.waitForResponse('GET', '/postcode-lookup');
      await billing.country.input.selectOption('DE');
      expect((await refused).response.status(), 'the lookup refuses the postcode for the new country').toBe(422);
      await expect(billing.lookupError).toHaveText(TEXT.postcodeInvalid);

      // And back: a good answer clears the error and fills the address again.
      await apiMock.use(mock.respond('GET', '/postcode-lookup', { ...POSTCODE_LOOKUP_RESULT, city: 'Backstad' }));
      const found = apiMock.waitForResponse('GET', '/postcode-lookup');
      await billing.country.input.selectOption('NL');
      expect((await found).response.status(), 'the lookup finds the address for the original country').toBe(200);
      await expect(billing.lookupError).toBeHidden();
      await expect(billing.city.input).toHaveValue('Backstad');
    });
  });

  test.describe('when the postcode lookup refuses a malformed postcode', { tag: ['@mocked', '@negative', '@bug'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 422, { message: TEXT.postcodeInvalid })));

    test('the shopper is told and cannot proceed with it', async ({ checkout }) => {
      knownBug('BUG-40', 'a postcode the lookup refuses as malformed is explained, but Proceed stays enabled once the rest of the address is typed.');
      const { billing } = checkout;

      const { status } = await billing.lookUp({ ...fakeAddress(), postalCode: '12' });
      await billing.completeAddress(fakeAddress());

      expect(status, 'the lookup refuses the postcode').toBe(422);
      await expect(billing.lookupError).toHaveText(TEXT.postcodeInvalid);
      await expect(billing.proceedButton, 'BUG-40: Proceed stays disabled while the postcode is malformed').toBeDisabled({ timeout: BUG_TIMEOUT });
    });
  });

  test('when answers arrive out of order, the address of the last house number is shown', { tag: ['@mocked', '@bug'] }, async ({ checkout, page }) => {
    knownBug('BUG-41', 'each change of the house number sends its own lookup and the page applies whichever answer arrives last, so a slow answer for an earlier number overwrites the address of the final one.');
    const { billing } = checkout;
    // The answer for the first house number is held back until the one for the second has been
    // served, as a slow network can do; nothing here waits for a fixed time.
    // This is a route of its own and not `apiMock.delay` on purpose: the two answers differ by the house number in the query, which
    // a mock answers by method and path only (a sequence would be spent by any stray lookup of a half-filled field), and a delay
    // is a timer, so it would only make the first answer *probably* later than the second. The release below makes the order exact.
    let secondServed!: () => void;
    const secondIsServed = new Promise<void>((resolve) => (secondServed = resolve));
    await page.route(/\/postcode-lookup/, async (route) => {
      const house = new URL(route.request().url()).searchParams.get('house_number');
      // Only the first number's answer waits, and only the second number's answer releases it: any other
      // lookup (the page may ask while a field is half filled) is answered at once and releases nothing.
      if (house === RACE.first.houseNumber) {
        await secondIsServed;
        return route.fulfill({ json: RACE.first.answer });
      }
      if (house !== RACE.second.houseNumber) return route.fulfill({ json: { ...POSTCODE_LOOKUP_RESULT, house_number: house } });
      await route.fulfill({ json: RACE.second.answer });
      secondServed();
    });
    const firstAsked = page.waitForRequest(lookupFor(RACE.first.houseNumber));
    const slow = page.waitForResponse(lookupFor(RACE.first.houseNumber));
    const fast = page.waitForResponse(lookupFor(RACE.second.houseNumber));

    await billing.country.input.selectOption(fakeAddress().country);
    await billing.postalCode.input.fill(fakeAddress().postalCode);
    await billing.houseNumber.input.fill(RACE.first.houseNumber);
    // The first question must be on its way before the second is asked, or the page may merge them.
    await firstAsked;
    await billing.houseNumber.input.fill(RACE.second.houseNumber);
    await fast;
    await slow;

    await expect(billing.city.input, 'BUG-41: the city is the one of the last house number').toHaveValue(RACE.second.answer.city, { timeout: BUG_TIMEOUT });
    await expect(billing.street.input, 'BUG-41: the street is the one of the last house number').toHaveValue(RACE.second.answer.street, { timeout: BUG_TIMEOUT });
  });

  test.describe('when the postcode lookup finds nothing', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 404, { message: TEXT.notFound })));

    test('the shopper is told and can type the address', async ({ checkout }) => {
      const { status } = await checkout.billing.lookUp(fakeAddress());

      expect(status, 'the lookup finds nothing').toBe(404);
      await expect(checkout.billing.lookupError).toHaveText(TEXT.notFound);
      await checkout.billing.completeAddress(fakeAddress());
      await expect(checkout.billing.proceedButton).toBeEnabled();
    });
  });

  test.describe('when the postcode lookup fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 500)));

    test('the error is shown and the address can still be typed', async ({ checkout }) => {
      const { status } = await checkout.billing.lookUp(fakeAddress());

      expect(status, 'the lookup fails').toBe(500);
      await expect(checkout.billing.lookupError).toHaveText(TEXT.serverError);
      await checkout.billing.completeAddress(fakeAddress());
      await expect(checkout.billing.proceedButton).toBeEnabled();
    });
  });
});

import { expect, mock, test, withMocks } from '@fixtures';
import { UNKNOWN_EMAIL, UNKNOWN_PASSWORD } from '@support/payloads';
import { fakeGuest } from '@support/test-data';

/** What the step tells the shopper, word for word. */
const TEXT = {
  emailRequired: 'Email is required',
  passwordRequired: 'Password is required',
  emailInvalid: 'Email format is invalid',
  passwordInvalid: 'Password length is invalid',
  firstNameRequired: 'First name is required',
  lastNameRequired: 'Last name is required',
  loginRefused: 'Invalid email or password',
  guestSummary: ({ firstName, lastName, email }: { firstName: string; lastName: string; email: string }) => `Continuing as guest: ${firstName} ${lastName} (${email})`,
  accountLocked: 'Account locked, too many failed attempts. Please contact the administrator.',
} as const;
/** An email the step's own validation refuses, in the sign-in form and the guest form alike. */
const MALFORMED_EMAIL = 'not-an-email';
/** A password under the shop's minimum length. */
const TOO_SHORT_PASSWORD = 'x';

test.describe('Checkout: sign-in step', () => {
  test.beforeEach(async ({ checkout }) => {
    await checkout.cart.proceed();
  });

  test('the step offers signing in or continuing as a guest', async ({ checkout }) => {
    await expect(checkout.signIn.loginButton).toBeVisible();
    await expect(checkout.signIn.continueAsGuestButton).toBeHidden();

    await checkout.signIn.guestTab.click();

    await expect(checkout.signIn.continueAsGuestButton).toBeVisible();
    await expect(checkout.signIn.loginButton).toBeHidden();
  });

  test('an empty login shows both required labels and sends no sign-in', { tag: ['@negative'] }, async ({ checkout, apiMock }) => {
    await checkout.signIn.loginButton.click();

    await expect(checkout.signIn.email.error).toHaveText(TEXT.emailRequired);
    await expect(checkout.signIn.password.error).toHaveText(TEXT.passwordRequired);
    await apiMock.expectNoRequest('POST', '/users/login');
  });

  test('a malformed email and a too-short password show errors and send no sign-in', { tag: ['@negative'] }, async ({ checkout, apiMock }) => {
    await checkout.signIn.signIn(MALFORMED_EMAIL, TOO_SHORT_PASSWORD);

    await expect(checkout.signIn.email.error).toHaveText(TEXT.emailInvalid);
    await expect(checkout.signIn.password.error).toHaveText(TEXT.passwordInvalid);
    await apiMock.expectNoRequest('POST', '/users/login');
  });

  // The real refusal is a failed sign-in on the shop's own log, so it runs on the self-hosted shop only;
  // the mocked twin below proves the same page behaviour everywhere, the live site included.
  test('unknown credentials are refused by the shop', { tag: ['@negative', '@self-hosted'] }, async ({ checkout }) => {
    await checkout.signIn.signIn(UNKNOWN_EMAIL, UNKNOWN_PASSWORD);

    await expect(checkout.signIn.loginError).toHaveText(TEXT.loginRefused);
    await expect(checkout.signIn.signInTab).toHaveAttribute('aria-selected', 'true');
    await expect(checkout.billing.heading).toBeHidden();
  });

  test.describe('when the shop refuses the credentials', { tag: ['@mocked', '@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/login', 401, { error: 'Unauthorized' })));

    test('the shopper is told so and stays on the sign-in step', async ({ checkout }) => {
      await checkout.signIn.signIn(UNKNOWN_EMAIL, UNKNOWN_PASSWORD);

      await expect(checkout.signIn.loginError).toHaveText(TEXT.loginRefused);
      await expect(checkout.signIn.signInTab).toHaveAttribute('aria-selected', 'true');
      await expect(checkout.billing.heading).toBeHidden();
    });

    // Lives here because the 401 mock only supplies a terminal answer, so the request is observed without a real login.
    test('spaces around the email are trimmed before it is sent', async ({ checkout, apiMock }) => {
      const asked = apiMock.waitForRequest('POST', '/users/login');

      await checkout.signIn.signIn(`  ${UNKNOWN_EMAIL}  `, UNKNOWN_PASSWORD);

      expect((await asked).postDataJSON()).toEqual({ email: UNKNOWN_EMAIL, password: UNKNOWN_PASSWORD });
      await expect(checkout.signIn.loginError).toHaveText(TEXT.loginRefused);
    });
  });

  // The shop locks an account after three failed attempts and answers 423 from then on. A mock answers it,
  // so no real account is locked.
  test.describe('when the shop has locked the account', { tag: ['@mocked', '@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/login', 423, { error: TEXT.accountLocked })));

    test('the shopper is told so and stays on the sign-in step', async ({ checkout }) => {
      await checkout.signIn.signIn(UNKNOWN_EMAIL, UNKNOWN_PASSWORD);

      await expect(checkout.signIn.loginError).toHaveText(TEXT.accountLocked);
      await expect(checkout.signIn.signInTab).toHaveAttribute('aria-selected', 'true');
      await expect(checkout.billing.heading).toBeHidden();
    });
  });

  test('guest details are required', { tag: ['@negative'] }, async ({ checkout }) => {
    await checkout.signIn.guestTab.click();
    await checkout.signIn.continueAsGuestButton.click();

    await expect(checkout.signIn.guestEmail.error).toHaveText(TEXT.emailRequired);
    await expect(checkout.signIn.guestFirstName.error).toHaveText(TEXT.firstNameRequired);
    await expect(checkout.signIn.guestLastName.error).toHaveText(TEXT.lastNameRequired);
  });

  test('a malformed guest email is rejected', { tag: ['@negative'] }, async ({ checkout }) => {
    await checkout.signIn.enterGuestDetails({ ...fakeGuest(), email: MALFORMED_EMAIL });

    await expect(checkout.signIn.guestEmail.error).toHaveText(TEXT.emailInvalid);
    await expect(checkout.signIn.proceedAsGuestButton).toBeHidden();
  });

  test('valid guest details are confirmed and lead to the billing address', async ({ checkout }) => {
    const guest = fakeGuest();

    await checkout.signIn.enterGuestDetails(guest);

    await expect(checkout.signIn.guestSummary).toHaveText(TEXT.guestSummary(guest));
    await checkout.signIn.proceedAsGuestButton.click();
    await expect(checkout.billing.heading).toBeVisible();
  });
});

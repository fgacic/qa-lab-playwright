import { expect, test } from '@fixtures';
import { fakeGuest } from '@support/test-data';

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

  test('an empty login shows both required labels', { tag: ['@negative'] }, async ({ checkout }) => {
    await checkout.signIn.loginButton.click();

    await expect(checkout.signIn.email.error).toHaveText('Email is required');
    await expect(checkout.signIn.password.error).toHaveText('Password is required');
  });

  test('a malformed email and a too-short password are rejected before sending', { tag: ['@negative'] }, async ({ checkout }) => {
    await checkout.signIn.signIn('not-an-email', 'x');

    await expect(checkout.signIn.email.error).toHaveText('Email format is invalid');
    await expect(checkout.signIn.password.error).toHaveText('Password length is invalid');
  });

  test('unknown credentials are refused', { tag: ['@negative'] }, async ({ checkout }) => {
    await checkout.signIn.signIn('nobody@example.invalid', 'not-a-real-password');

    await expect(checkout.signIn.loginError).toHaveText('Invalid email or password');
    await expect(checkout.billing.heading).toBeHidden();
  });

  test('guest details are required', { tag: ['@negative'] }, async ({ checkout }) => {
    await checkout.signIn.guestTab.click();
    await checkout.signIn.continueAsGuestButton.click();

    await expect(checkout.signIn.guestEmail.error).toHaveText('Email is required');
    await expect(checkout.signIn.guestFirstName.error).toHaveText('First name is required');
    await expect(checkout.signIn.guestLastName.error).toHaveText('Last name is required');
  });

  test('a malformed guest email is rejected', { tag: ['@negative'] }, async ({ checkout }) => {
    await checkout.signIn.enterGuestDetails({ ...fakeGuest(), email: 'not-an-email' });

    await expect(checkout.signIn.guestEmail.error).toHaveText('Email format is invalid');
    await expect(checkout.signIn.proceedAsGuestButton).toBeHidden();
  });

  test('valid guest details are confirmed and lead to the billing address', async ({ checkout }) => {
    const guest = fakeGuest();

    await checkout.signIn.enterGuestDetails(guest);

    await expect(checkout.signIn.guestSummary).toHaveText(`Continuing as guest: ${guest.firstName} ${guest.lastName} (${guest.email})`);
    await checkout.signIn.proceedAsGuestButton.click();
    await expect(checkout.billing.heading).toBeVisible();
  });
});

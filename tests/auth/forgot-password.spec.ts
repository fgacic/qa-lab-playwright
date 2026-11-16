import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { UNKNOWN_EMAIL, fakeUser } from '@support/payloads';

/** Some text, and none of it a translation key such as "page.forgot-password.confirm". */
const READABLE = /^(?!.*\bpage\.[\w-]+\.[\w-]+)\s*\S/s;

test.describe('Forgot password', () => {
  // The form's own validation must stop the first two: nothing answers POST /users/forgot-password in them,
  // so the guard refuses a request that should never leave, and `expectNoRequest` proves none was sent.
  test('an empty email is required', { tag: ['@negative'] }, async ({ forgotPasswordPage, apiMock }) => {
    await apiMock.blockUnmockedWrites();

    await forgotPasswordPage.submitButton.click();

    await expect(forgotPasswordPage.email.error).toHaveText('Email is required');
    await apiMock.expectNoRequest('POST', '/users/forgot-password');
  });

  test('a malformed email says what is wrong', { tag: ['@negative', '@bug'] }, async ({ forgotPasswordPage, apiMock }) => {
    knownBug('BUG-19', 'for a malformed email the error label appears but is empty.');
    await apiMock.blockUnmockedWrites();
    await forgotPasswordPage.requestReset('not-an-email');
    await expect(forgotPasswordPage.email.error).toBeAttached();
    await apiMock.expectNoRequest('POST', '/users/forgot-password');

    await expect(forgotPasswordPage.email.error, 'BUG-19: the email error names the problem').toHaveText('Email format is invalid', { timeout: 5_000 });
  });

  // The real refusal is a failed request on the shop's own log, so it runs on the self-hosted shop only;
  // the mocked twin below proves the same page behaviour everywhere, the live site included.
  test('an unknown email is refused by the shop', { tag: ['@negative', '@self-hosted'] }, async ({ forgotPasswordPage }) => {
    await forgotPasswordPage.requestReset(UNKNOWN_EMAIL);

    await expect(forgotPasswordPage.alert).toHaveText('The selected email is invalid.');
  });

  test.describe('when the shop does not know the email', { tag: ['@mocked', '@negative'] }, () => {
    // The body the real API answers with (422).
    test.use(withMocks(mock.fail('POST', '/users/forgot-password', 422, { message: 'The selected email is invalid.', errors: { email: ['The selected email is invalid.'] } })));

    test('the refusal is shown', { tag: ['@smoke'] }, async ({ forgotPasswordPage }) => {
      await forgotPasswordPage.requestReset(UNKNOWN_EMAIL);

      await expect(forgotPasswordPage.alert).toHaveText('The selected email is invalid.');
    });
  });

  test.describe('when the reset is accepted', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.respond('POST', '/users/forgot-password', { success: true })));

    test('a readable confirmation is shown', async ({ forgotPasswordPage }) => {
      knownBug('BUG-20', 'the success message is the raw translation key "page.forgot-password.confirm".');
      await forgotPasswordPage.requestReset(fakeUser.email);
      // Whatever it says, the form answers the request with a message.
      await expect(forgotPasswordPage.alert).toBeVisible();

      // One assertion on the same alert: it is not a raw key and it says something. The alert fades out after
      // three seconds, so the timeout stays short; a fixed site passes on the first look, whatever the wording.
      await expect(forgotPasswordPage.alert, 'BUG-20: the confirmation is readable text, not a raw translation key').toHaveText(READABLE, { timeout: 2_000 });
    });
  });

  test.describe('when the reset is submitted with Enter', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/users/forgot-password', { success: true })));

    test('Enter in the email field sends the request as the button does', async ({ forgotPasswordPage, apiMock }) => {
      const sent = apiMock.waitForRequest('POST', '/users/forgot-password');

      await forgotPasswordPage.requestResetWithEnter(fakeUser.email);

      expect((await sent).postDataJSON()).toEqual({ email: fakeUser.email });
    });
  });

  test.describe('when the reset request fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/forgot-password', 500)));

    test('the error is shown', async ({ forgotPasswordPage }) => {
      await forgotPasswordPage.requestReset(fakeUser.email);

      await expect(forgotPasswordPage.alert).toHaveText('Server Error');
    });
  });
});

import { expect, mock, test, withMocks } from '@fixtures';
import { FIELD_ERRORS } from '@components/FormField';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { UNKNOWN_EMAIL, fakeUser, serverError } from '@support/payloads';

/** Some text, and none of it a translation key such as "page.forgot-password.confirm". */
const READABLE = /^(?!.*\bpage\.[\w-]+\.[\w-]+)\s*\S/s;
/** The confirmation alert fades out after 3 s: a pin on it must give up before that, so it fails on its text and not on a missing element. */
const ALERT_FADE_WINDOW = 2_000;

/** The one sentence the shop refuses an unknown email with, typed once for the mocked body and both assertions. */
const UNKNOWN_EMAIL_REFUSED = 'The selected email is invalid.';

test.describe('Forgot password', () => {
  // The form's own validation must stop the first two: nothing answers POST /users/forgot-password in them,
  // so the guard refuses a request that should never leave, and `expectNoRequest` proves none was sent.
  test('an empty email is required', { tag: ['@negative'] }, async ({ forgotPasswordPage, apiMock }) => {
    await apiMock.blockUnmockedWrites();

    await forgotPasswordPage.submitButton.click();

    await expect(forgotPasswordPage.email.error).toHaveText(FIELD_ERRORS.required('Email'));
    await apiMock.expectNoRequest('POST', '/users/forgot-password');
  });

  test('a malformed email says what is wrong', { tag: ['@negative', '@bug'] }, async ({ forgotPasswordPage, apiMock }) => {
    knownBug('BUG-19', 'for a malformed email the error label appears but is empty.');
    await apiMock.blockUnmockedWrites();
    await forgotPasswordPage.requestReset('not-an-email');
    await expect(forgotPasswordPage.email.error).toBeAttached();
    await apiMock.expectNoRequest('POST', '/users/forgot-password');

    await expect(forgotPasswordPage.email.error, 'BUG-19: the email error names the problem').toHaveText(FIELD_ERRORS.emailInvalid, { timeout: BUG_TIMEOUT });
  });

  // The real refusal is a failed request on the shop's own log, so it runs on the self-hosted shop only;
  // the mocked twin below proves the same page behaviour everywhere, the live site included.
  test('an unknown email is refused by the shop', { tag: ['@negative', '@self-hosted'] }, async ({ forgotPasswordPage, consoleGuard }) => {
    consoleGuard.allowStatus(422, '/users/forgot-password', 'the one refusal this test provokes on purpose: the shop does not know the email, and the browser logs every 4xx answer');
    await forgotPasswordPage.requestReset(UNKNOWN_EMAIL);

    await expect(forgotPasswordPage.alert).toHaveText(UNKNOWN_EMAIL_REFUSED);
  });

  test.describe('when the shop does not know the email', { tag: ['@mocked', '@negative'] }, () => {
    // The body the real API answers with (422).
    test.use(withMocks(mock.fail('POST', '/users/forgot-password', 422, { message: UNKNOWN_EMAIL_REFUSED, errors: { email: [UNKNOWN_EMAIL_REFUSED] } })));

    test('the refusal is shown', { tag: ['@smoke'] }, async ({ forgotPasswordPage }) => {
      await forgotPasswordPage.requestReset(UNKNOWN_EMAIL);

      await expect(forgotPasswordPage.alert).toHaveText(UNKNOWN_EMAIL_REFUSED);
    });
  });

  test.describe('when the reset is accepted', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.respond('POST', '/users/forgot-password', { success: true })));

    test('a readable confirmation is shown', async ({ forgotPasswordPage }) => {
      knownBug('BUG-20', 'the success message is the raw translation key "page.forgot-password.confirm".');
      await forgotPasswordPage.requestReset(fakeUser.email);

      // One assertion on the alert, with no look before it: a separate "is visible" would start the fade (3 s) before the window
      // does and could leave it with nothing to read. It waits for the alert, and for text that is not a raw key and says something;
      // the window stays under the fade (BUG_TIMEOUT would outlive it and end on "element not found"), and a fixed site passes
      // on the first look, whatever the wording.
      await expect(forgotPasswordPage.alert, 'BUG-20: the confirmation is readable text, not a raw translation key').toHaveText(READABLE, { timeout: ALERT_FADE_WINDOW });
    });
  });

  test.describe('when the reset is submitted with Enter', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('POST', '/users/forgot-password', { success: true })));

    test('Enter in the email field sends the request as the button does', async ({ forgotPasswordPage, apiMock }) => {
      const sent = apiMock.waitForRequest('POST', '/users/forgot-password');

      await forgotPasswordPage.requestResetWithEnter(fakeUser.email);

      expect((await sent).postDataJSON()).toEqual({ email: fakeUser.email });
      // The same answer as the button's: the form acknowledges the request with some text. (Its wording is BUG-20's business.)
      await expect(forgotPasswordPage.alert).toHaveText(/\S/);
    });
  });

  test.describe('when the reset request fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/forgot-password', 500)));

    test('the error is shown', async ({ forgotPasswordPage }) => {
      await forgotPasswordPage.requestReset(fakeUser.email);

      await expect(forgotPasswordPage.alert).toHaveText(serverError.message);
    });
  });
});

import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';

test.describe('Forgot password', () => {
  test('an empty email is required', { tag: ['@negative'] }, async ({ forgotPasswordPage }) => {
    await forgotPasswordPage.submitButton.click();

    await expect(forgotPasswordPage.email.error).toHaveText('Email is required');
  });

  test('a malformed email says what is wrong', { tag: ['@negative', '@bug'] }, async ({ forgotPasswordPage }) => {
    knownBug('BUG-19', 'for a malformed email the error label appears but is empty.');
    await forgotPasswordPage.requestReset('not-an-email');
    await expect(forgotPasswordPage.email.error).toBeAttached();

    await expect(forgotPasswordPage.email.error).toHaveText('Email format is invalid', { timeout: 5_000 });
  });

  test('an unknown email is refused', { tag: ['@negative'] }, async ({ forgotPasswordPage }) => {
    await forgotPasswordPage.requestReset('nobody@example.invalid');

    await expect(forgotPasswordPage.alert).toHaveText('The selected email is invalid.');
  });

  test.describe('when the reset is accepted', { tag: ['@mocked', '@bug'] }, () => {
    test.use(withMocks(mock.respond('POST', '/users/forgot-password', { success: true })));

    test('a readable confirmation is shown', async ({ forgotPasswordPage }) => {
      knownBug('BUG-20', 'the success message is the raw translation key "page.forgot-password.confirm".');
      await forgotPasswordPage.requestReset('testy.mctestface@example.com');

      // The message fades out after three seconds, hence the short timeout.
      await expect(forgotPasswordPage.statusMessage(/sent|check your (e-)?mail|instructions/i)).toBeVisible({ timeout: 2_500 });
    });
  });

  test.describe('when the reset request fails', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/forgot-password', 500)));

    test('the error is shown', async ({ forgotPasswordPage }) => {
      await forgotPasswordPage.requestReset('testy.mctestface@example.com');

      await expect(forgotPasswordPage.alert).toHaveText('Server Error');
    });
  });
});

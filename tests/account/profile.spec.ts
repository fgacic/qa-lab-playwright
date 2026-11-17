import { expect, mock, test, withMocks } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeUser } from '@support/payloads';

const PROFILE_PATH = /^\/users\/[^/]+$/;
const [OLD_PASSWORD, NEW_PASSWORD, WRONG_PASSWORD] = ['Qa-lab-old-pass-1!', 'Qa-lab-new-pass-2!', 'Qa-lab-wrong-pass-1!'];
/** Both the profile and the password confirmations contain it; neither may appear after a refusal. */
const SAVED_NOTICE = 'successfully updated';
const PROFILE_SAVED = 'Your profile is successfully updated!';
const PASSWORD_SAVED = 'Your password is successfully updated!';
const FORM_INVALID = 'Please correct the highlighted fields before saving.';
const SERVER_ERROR = 'Server Error';
const RENAMED = 'Renamed';
const MOVED = { country: 'BE', postal_code: '9000', state: 'Oost-Vlaanderen' };
const NOT_A_PHONE = 'abc';
/** What the shop's refusals say, typed once for the mock and for the assertion. */
const FIRST_NAME_TOO_LONG = 'The first name field must not be greater than 40 characters.';
const CONFIRMATION_MISMATCH = 'The new password field confirmation does not match.';
const WRONG_CURRENT_PASSWORD = 'Your current password does not matches with the password.';

/** The profile page with a mocked session: a fake token and mocked account endpoints, so it runs anywhere without an account. */
test.describe('Account profile (mocked session)', { tag: ['@mocked'] }, () => {
  // Replaces the set above (a nested `test.use` does not merge), so the profile page's own POST /totp/setup needs its mock here too.
  test.use(withMocks(
    mock.respond('POST', '/totp/setup', {}),
    mock.respond('PUT', PROFILE_PATH, { success: true }),
    mock.respond('POST', '/users/change-password', { success: true }),
  ));

  test('shows the account\'s own details', async ({ profilePage }) => {
    await expect(profilePage.firstName.input).toHaveValue(fakeUser.first_name);
    await expect(profilePage.lastName.input).toHaveValue(fakeUser.last_name);
    await expect(profilePage.email.input).toHaveValue(fakeUser.email);
    await expect(profilePage.street.input).toHaveValue(fakeUser.address.street);
    await expect(profilePage.postalCode.input).toHaveValue(fakeUser.address.postal_code);
    await expect(profilePage.city.input).toHaveValue(fakeUser.address.city);
    await expect(profilePage.state.input).toHaveValue(fakeUser.address.state);
    await expect(profilePage.country.input).toHaveValue(fakeUser.address.country);
  });

  test('the profile page raises no application error', { tag: ['@bug'] }, async ({ profilePage, apiMock, consoleGuard }) => {
    knownBug('BUG-37', 'the profile page draws its two-factor QR code from an empty secret and logs "[angularx-qrcode] Field `qrdata` is empty" as an error on every visit.');
    // Precondition, true whether or not the bug is fixed: the page is filled in, its QR widget is on the page and the two-factor setup has been answered.
    // The widget logs the moment it renders (before the setup's answer arrives) and again after it, so once it is attached the log can be read.
    await expect(profilePage.email.input).toHaveValue(fakeUser.email);
    await expect(profilePage.qrCode).toBeAttached();
    await expect.poll(() => apiMock.answers, { message: 'POST /totp/setup was answered' }).toContainEqual({ pathname: '/totp/setup', outcome: 200 });

    await expect(consoleGuard.expectNoneLogged(/angularx-qrcode/), 'BUG-37: the QR code widget logged an error').resolves.toBeUndefined();
  });

  test('saving sends the edited profile', async ({ profilePage, apiMock }) => {
    const saved = apiMock.waitForRequest('PUT', PROFILE_PATH);
    await profilePage.firstName.input.fill(RENAMED);

    await profilePage.update();

    expect((await saved).postDataJSON()).toMatchObject({ first_name: RENAMED, last_name: fakeUser.last_name });
    await expect(profilePage.alert(PROFILE_SAVED)).toBeVisible();
  });

  test('saving sends the edited address', async ({ profilePage, apiMock }) => {
    const saved = apiMock.waitForRequest('PUT', PROFILE_PATH);
    await profilePage.country.input.fill(MOVED.country);
    await profilePage.postalCode.input.fill(MOVED.postal_code);
    await profilePage.state.input.fill(MOVED.state);

    await profilePage.update();

    expect((await saved).postDataJSON().address).toEqual({ ...fakeUser.address, ...MOVED });
    await expect(profilePage.alert(PROFILE_SAVED)).toBeVisible();
  });

  test('an empty postal code is stopped by the form', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    await profilePage.postalCode.input.fill('');

    await profilePage.update();

    await expect(profilePage.alert(FORM_INVALID)).toBeVisible();
    await apiMock.expectNoRequest('PUT', PROFILE_PATH);
  });

  test('answering a password change raises no application error', { tag: ['@bug'] }, async ({ profilePage, apiMock, consoleGuard }) => {
    knownBug('BUG-47', 'the profile page throws "TypeError: Cannot read properties of undefined (reading \'value\')" every time its change-password request is answered, although the page then shows the answer.');
    const answered = apiMock.waitForResponse('POST', '/users/change-password');

    await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);
    await answered;
    // Precondition, true whether or not the bug is fixed: the page took the answer in and shows it. The handler throws before the alert is
    // drawn (the throw is logged first, the alert follows on the next render), so once the alert is up the throw is already in the log.
    await expect(profilePage.alert(PASSWORD_SAVED)).toBeVisible();

    await expect(consoleGuard.expectNoneLogged(/TypeError:[^\n]*\bvalue\b/), 'BUG-47: the answer to a password change threw').resolves.toBeUndefined();
  });

  test('changing the password sends the current and the new one', async ({ profilePage, apiMock }) => {
    const sent = apiMock.waitForRequest('POST', '/users/change-password');

    await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);

    expect((await sent).postDataJSON()).toEqual({
      current_password: OLD_PASSWORD,
      new_password: NEW_PASSWORD,
      new_password_confirmation: NEW_PASSWORD,
    });
    await expect(profilePage.alert(PASSWORD_SAVED)).toBeVisible();
  });

  test('an empty password change is stopped by the form', { tag: ['@negative', '@bug'] }, async ({ profilePage, apiMock }) => {
    knownBug('BUG-26', 'Change Password with every field empty is sent to the API instead of being validated in the form.', { absence: true });
    await expect(profilePage.changePasswordButton).toBeVisible();
    const before = await apiMock.mark();

    await profilePage.changePasswordButton.click();

    // The defect itself: the request leaves. Checked first, so a form that validates and a form that merely words the refusal differ.
    await expect(apiMock.expectNoRequest('POST', '/users/change-password', { since: before }), 'BUG-26: no request is sent').resolves.toBeUndefined();
    // And, once nothing is sent, the form says what is missing (the wording is a separate matter from the request).
    await expect(profilePage.alert(/required/i).first(), 'BUG-26: the form names the missing fields').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  test('a confirmation that differs from the new password shows the API reason', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    // The real API answers 422 with this body (the form does not compare the two fields itself).
    await apiMock.use(mock.fail('POST', '/users/change-password', 422, {
      message: CONFIRMATION_MISMATCH,
      errors: { new_password: [CONFIRMATION_MISMATCH] },
    }));
    const sent = apiMock.waitForRequest('POST', '/users/change-password');

    await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD, WRONG_PASSWORD);

    expect((await sent).postDataJSON()).toMatchObject({ new_password: NEW_PASSWORD, new_password_confirmation: WRONG_PASSWORD });
    await expect(profilePage.alert(CONFIRMATION_MISMATCH)).toBeVisible();
    await expect(profilePage.alert(SAVED_NOTICE)).toHaveCount(0);
  });

  test('an empty first name is stopped by the form', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    await profilePage.firstName.input.fill('');

    await profilePage.update();

    await expect(profilePage.alert(FORM_INVALID)).toBeVisible();
    await apiMock.expectNoRequest('PUT', PROFILE_PATH);
  });

  // The email field is read-only on this page, so the profile's format check is exercised through the phone number.
  test('a malformed phone number is stopped by the form', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    await profilePage.phone.input.fill(NOT_A_PHONE);

    await profilePage.update();

    await expect(profilePage.alert('Please enter a valid phone number (digits, spaces and ( ) + - only).')).toBeVisible();
    await apiMock.expectNoRequest('PUT', PROFILE_PATH);
  });

  test('a profile the API rejects shows its reason', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    await apiMock.use(mock.fail('PUT', PROFILE_PATH, 422, { first_name: [FIRST_NAME_TOO_LONG] }));

    await profilePage.update();

    await expect(profilePage.alert(FIRST_NAME_TOO_LONG)).toBeVisible();
    await expect(profilePage.alert(SAVED_NOTICE)).toHaveCount(0);
  });

  // The two ways a request fails besides a refusal with a reason: the API answers 500, or is not reached at all.
  test('saving the profile when the API answers 500 shows the failure, not a success', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    await apiMock.use(mock.fail('PUT', PROFILE_PATH, 500));

    await profilePage.update();

    await expect(profilePage.alert(SERVER_ERROR)).toBeVisible();
    await expect(profilePage.alert(SAVED_NOTICE)).toHaveCount(0);
  });

  test('saving the profile when the API cannot be reached shows the failure, not a success', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    await apiMock.use(mock.abort('PUT', PROFILE_PATH));
    const attempted = apiMock.waitForRequest('PUT', PROFILE_PATH);

    await profilePage.update();
    await attempted;

    await expect(profilePage.alert('An unexpected error occurred.')).toBeVisible();
    await expect(profilePage.alert(SAVED_NOTICE)).toHaveCount(0);
  });

  test('changing the password when the API answers 500 shows the failure, not a success', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    await apiMock.use(mock.fail('POST', '/users/change-password', 500));

    await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);

    await expect(profilePage.alert(SERVER_ERROR)).toBeVisible();
    await expect(profilePage.alert(SAVED_NOTICE)).toHaveCount(0);
  });

  test('changing the password when the API cannot be reached tells the customer', { tag: ['@negative', '@bug'] }, async ({ profilePage, apiMock }) => {
    knownBug('BUG-51', 'a change-password request that never reaches the API is not reported: no alert, although a failed profile save says "An unexpected error occurred".', { absence: true });
    await apiMock.use(mock.abort('POST', '/users/change-password'));
    const attempted = apiMock.waitForRequest('POST', '/users/change-password');

    await profilePage.changePassword(OLD_PASSWORD, NEW_PASSWORD);
    await attempted;

    // Any alert but a success notice: a fixed page says the change failed, and a page that claimed success would not satisfy this.
    await expect(profilePage.alerts.filter({ hasNotText: SAVED_NOTICE }).first(), 'BUG-51: the customer is told the password was not changed').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  test('a wrong current password shows the API reason', { tag: ['@negative'] }, async ({ profilePage, apiMock }) => {
    // The real API answers 400 with this body.
    await apiMock.use(mock.fail('POST', '/users/change-password', 400, { success: false, message: WRONG_CURRENT_PASSWORD }));

    await profilePage.changePassword(WRONG_PASSWORD, NEW_PASSWORD);

    await expect(profilePage.alert(WRONG_CURRENT_PASSWORD)).toBeVisible();
    await expect(profilePage.alert(SAVED_NOTICE)).toHaveCount(0);
  });
});

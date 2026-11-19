import { expect, mock, test, withMocks } from '@fixtures';
import { FIELD_ERRORS } from '@components/FormField';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { MOCKED_PASSWORD, UNKNOWN_EMAIL, UNKNOWN_PASSWORD, fakeJwt, fakeUser } from '@support/payloads';
import { storedToken } from '@support/session';

/** The pending token the API hands out when the account needs a second factor, and the codes the TOTP tests type. */
const PENDING_TOTP = 'qa-lab-pending-totp';
const TOTP_CODE = '123456';
const WRONG_TOTP_CODE = '000000';
/** What the shop's refusals say, typed once for the mock and the assertion. */
const REFUSED = 'Invalid email or password';
const LOCKED = 'Account locked, too many failed attempts. Please contact the administrator.';
/** The other messages the page shows: for a password that is too short, for a TOTP step left empty, and for any failure that is not a refusal. */
const PASSWORD_LENGTH = 'Password length is invalid';
const TOTP_REQUIRED = 'TOTP code is required';
const LOGIN_FAILED = 'Login failed';
/** The error body of the API's 401: the word the page shows as it is when a TOTP code is refused. */
const UNAUTHORIZED = 'Unauthorized';

/**
 * Real requests in this file use only obviously fake credentials (UNKNOWN_EMAIL, UNKNOWN_PASSWORD).
 * Successful sign-ins are mocked end to end: no real account is touched.
 */
test.describe('Login', () => {
  test('an empty form shows both required labels', { tag: ['@negative'] }, async ({ loginPage, apiMock }) => {
    // Nothing answers POST /users/login here, so the guard refuses a request that should never leave.
    await apiMock.blockUnmockedWrites();

    await loginPage.loginButton.click();

    await expect(loginPage.email.error).toHaveText(FIELD_ERRORS.required('Email'));
    await expect(loginPage.password.error).toHaveText(FIELD_ERRORS.required('Password'));
    await apiMock.expectNoRequest('POST', '/users/login');
  });

  test('a malformed email and a too-short password are rejected before sending', { tag: ['@negative'] }, async ({ loginPage, apiMock }) => {
    // Nothing answers POST /users/login here, so the guard refuses a request that should never leave.
    await apiMock.blockUnmockedWrites();

    await loginPage.login('not-an-email', 'x');

    await expect(loginPage.email.error).toHaveText(FIELD_ERRORS.emailInvalid);
    await expect(loginPage.password.error).toHaveText(PASSWORD_LENGTH);
    await apiMock.expectNoRequest('POST', '/users/login');
  });

  // The real refusal is a failed sign-in on the shop's own log, so it runs on the self-hosted shop only (the one unknown
  // credential per browser project is harmless there: security/login-lockout owns the lockout, and the account is unknown);
  // the mocked twin below proves the same page behaviour everywhere, the live site included.
  test('unknown credentials are refused by the shop', { tag: ['@negative', '@self-hosted'] }, async ({ loginPage, page }) => {
    await loginPage.login(UNKNOWN_EMAIL, UNKNOWN_PASSWORD);

    await expect(loginPage.error).toHaveText(REFUSED);
    await expect(page).toHaveURL('/auth/login');
  });

  test.describe('when the shop refuses the credentials', { tag: ['@mocked', '@negative'] }, () => {
    // The body the real API answers with (401).
    test.use(withMocks(mock.fail('POST', '/users/login', 401, { error: UNAUTHORIZED })));

    test('the shopper is told so and stays on the login page', { tag: ['@smoke'] }, async ({ loginPage, page }) => {
      await loginPage.login(UNKNOWN_EMAIL, UNKNOWN_PASSWORD);

      await expect(loginPage.error).toHaveText(REFUSED);
      await expect(page).toHaveURL('/auth/login');
    });
  });

  test('the eye button shows and hides the password', async ({ loginPage }) => {
    await loginPage.password.input.fill(UNKNOWN_PASSWORD);
    await expect(loginPage.password.input).toHaveAttribute('type', 'password');

    await loginPage.showPasswordButton.click();
    await expect(loginPage.password.input).toHaveAttribute('type', 'text');

    await loginPage.showPasswordButton.click();
    await expect(loginPage.password.input).toHaveAttribute('type', 'password');
  });

  test('the registration link leads to registration', async ({ loginPage, page }) => {
    await loginPage.registerLink.click();

    await expect(page).toHaveURL('/auth/register');
  });

  test('the password reset link leads to password reset', async ({ loginPage, page }) => {
    await loginPage.forgotPasswordLink.click();

    await expect(page).toHaveURL('/auth/forgot-password');
  });

  test('Google sign-in is offered', async ({ loginPage }) => {
    // Not clicked: it starts a real OAuth flow with a third party. Offered means a button by that name that a visitor can use.
    await expect(loginPage.googleButton).toBeVisible();
    await expect(loginPage.googleButton).toBeEnabled();
  });

  test.describe('when the credentials are accepted', { tag: ['@mocked'] }, () => {
    const token = fakeJwt();
    test.use(withMocks(
      mock.respond('POST', '/users/login', { access_token: token, token_type: 'bearer', expires_in: 3600 }),
      mock.respond('GET', '/users/me', fakeUser),
    ));

    test('the customer lands in the account area, signed in', async ({ loginPage, apiMock, page }) => {
      const login = apiMock.waitForRequest('POST', '/users/login');
      await loginPage.login(fakeUser.email, MOCKED_PASSWORD);

      expect((await login).postDataJSON()).toEqual({ email: fakeUser.email, password: MOCKED_PASSWORD });
      await expect(page).toHaveURL('/account');
      await expect(loginPage.shell.header.userMenu).toHaveText(`${fakeUser.first_name} ${fakeUser.last_name}`);
      await expect(loginPage.shell.header.signInLink).toHaveCount(0);
      await expect.poll(() => storedToken(page), { message: 'the SPA keeps the token it was given' }).toBe(token);
    });

    test('Enter in the password field signs in as the button does', async ({ loginPage, apiMock, page }) => {
      const login = apiMock.waitForRequest('POST', '/users/login');

      await loginPage.loginWithEnter(fakeUser.email, MOCKED_PASSWORD);

      expect((await login).postDataJSON()).toEqual({ email: fakeUser.email, password: MOCKED_PASSWORD });
      await expect(page).toHaveURL('/account');
    });
  });

  test.describe('when the account uses two-factor authentication', { tag: ['@mocked'] }, () => {
    test.use(withMocks(
      mock.sequence('POST', '/users/login',
        { status: 200, json: { requires_totp: true, access_token: PENDING_TOTP } },
        { status: 200, json: { access_token: fakeJwt(), token_type: 'bearer', expires_in: 3600 } }),
      mock.respond('GET', '/users/me', fakeUser),
    ));

    test('the password step asks for a TOTP code, which completes the login', async ({ loginPage, apiMock, page }) => {
      await loginPage.login(fakeUser.email, MOCKED_PASSWORD);
      await expect(loginPage.totpCode).toBeVisible();
      await expect(loginPage.password.input).toBeHidden();

      const verification = apiMock.waitForRequest('POST', '/users/login');
      await loginPage.verifyTotp(TOTP_CODE);

      expect((await verification).postDataJSON()).toEqual({ totp: TOTP_CODE, access_token: PENDING_TOTP });
      await expect(page).toHaveURL('/account');
    });

    test('an empty TOTP code is refused', { tag: ['@negative'] }, async ({ loginPage, apiMock }) => {
      await loginPage.login(fakeUser.email, MOCKED_PASSWORD);
      await expect(loginPage.totpCode).toBeVisible();
      const before = await apiMock.mark();

      await loginPage.verifyTotp('');

      await expect(loginPage.error).toHaveText(TOTP_REQUIRED);
      // The mocked sequence would answer a second request with a full login: none may leave for an empty code.
      await apiMock.expectNoRequest('POST', '/users/login', { since: before });
    });
  });

  test.describe('when the TOTP code is wrong', { tag: ['@mocked', '@negative'] }, () => {
    // The first answer asks for a code; the second refuses it, the way the real API refuses a bad credential.
    test.use(withMocks(mock.sequence('POST', '/users/login',
      { status: 200, json: { requires_totp: true, access_token: PENDING_TOTP } },
      { status: 401, json: { error: UNAUTHORIZED } })));

    test('the code is refused and the customer stays on login', async ({ loginPage, apiMock, page }) => {
      await loginPage.login(fakeUser.email, MOCKED_PASSWORD);
      await expect(loginPage.totpCode).toBeVisible();

      const verification = apiMock.waitForResponse('POST', '/users/login');
      await loginPage.verifyTotp(WRONG_TOTP_CODE);

      expect((await verification).response.status()).toBe(401);
      // The page shows the API's raw word: that is the shop's current wording for a refused code (it has no sentence for it),
      // so the test pins what is on screen today and a reworded message is a deliberate edit here.
      await expect(loginPage.error).toHaveText(UNAUTHORIZED);
      await expect(page).toHaveURL('/auth/login');
      // The error above is on screen, so a header that is still without a user menu is settled, not early.
      await expect(loginPage.shell.header.userMenu).toHaveCount(0);
    });
  });

  test('the show-password button has an accessible name', { tag: ['@a11y', '@bug'] }, async ({ loginPage }) => {
    knownBug('A11Y-02', 'the eye button that shows the password has no accessible name (login, register, profile).');
    await expect(loginPage.showPasswordButton).toBeVisible();

    await expect(loginPage.showPasswordButton, 'A11Y-02: the eye button has an accessible name').toHaveAccessibleName(/show|hide|password/i, { timeout: BUG_TIMEOUT });
  });

  test.describe('when the account is locked', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/login', 423, { error: LOCKED })));

    test('the API reason is shown', async ({ loginPage }) => {
      await loginPage.login(fakeUser.email, MOCKED_PASSWORD);

      await expect(loginPage.error).toHaveText(LOCKED);
    });
  });

  const apiFailures = [
    { how: 'answers 500', failure: mock.fail('POST', '/users/login', 500) },
    { how: 'cannot be reached', failure: mock.abort('POST', '/users/login') },
  ];
  for (const { how, failure } of apiFailures) {
    test.describe(`when the login API ${how}`, { tag: ['@mocked'] }, () => {
      test.use(withMocks(failure));

      test('a generic "Login failed" is shown', async ({ loginPage, page }) => {
        await loginPage.login(fakeUser.email, MOCKED_PASSWORD);

        await expect(loginPage.error).toHaveText(LOGIN_FAILED);
        await expect(page).toHaveURL('/auth/login');
      });
    });
  }
});

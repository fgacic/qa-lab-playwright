import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { fakeJwt, fakeUser } from '@support/payloads';

/**
 * Real requests in this file use only obviously fake credentials (nobody@example.invalid).
 * Successful sign-ins are mocked end to end: no real account is touched.
 */
test.describe('Login', () => {
  test('an empty form shows both required labels', { tag: ['@negative'] }, async ({ loginPage }) => {
    await loginPage.loginButton.click();

    await expect(loginPage.email.error).toHaveText('Email is required');
    await expect(loginPage.password.error).toHaveText('Password is required');
  });

  test('a malformed email and a too-short password are rejected before sending', { tag: ['@negative'] }, async ({ loginPage, apiMock }) => {
    // Nothing answers POST /users/login here, so the guard refuses a request that should never leave.
    await apiMock.blockUnmockedWrites();

    await loginPage.login('not-an-email', 'x');

    await expect(loginPage.email.error).toHaveText('Email format is invalid');
    await expect(loginPage.password.error).toHaveText('Password length is invalid');
    await apiMock.expectNoRequest('POST', '/users/login');
  });

  // The real refusal is a failed sign-in on the shop's own log, so it runs on the self-hosted shop only;
  // the mocked twin below proves the same page behaviour everywhere, the live site included.
  test('unknown credentials are refused by the shop', { tag: ['@negative', '@self-hosted'] }, async ({ loginPage, page }) => {
    await loginPage.login('nobody@example.invalid', 'not-a-real-password');

    await expect(loginPage.error).toHaveText('Invalid email or password');
    await expect(page).toHaveURL('/auth/login');
  });

  test.describe('when the shop refuses the credentials', { tag: ['@mocked', '@negative'] }, () => {
    // The body the real API answers with (401).
    test.use(withMocks(mock.fail('POST', '/users/login', 401, { error: 'Unauthorized' })));

    test('the shopper is told so and stays on the login page', { tag: ['@smoke'] }, async ({ loginPage, page }) => {
      await loginPage.login('nobody@example.invalid', 'not-a-real-password');

      await expect(loginPage.error).toHaveText('Invalid email or password');
      await expect(page).toHaveURL('/auth/login');
    });
  });

  test('the eye button shows and hides the password', async ({ loginPage }) => {
    await loginPage.password.input.fill('not-a-real-password');
    await expect(loginPage.password.input).toHaveAttribute('type', 'password');

    await loginPage.showPasswordButton.click();
    await expect(loginPage.password.input).toHaveAttribute('type', 'text');

    await loginPage.showPasswordButton.click();
    await expect(loginPage.password.input).toHaveAttribute('type', 'password');
  });

  test('links lead to registration and password reset', async ({ loginPage, page }) => {
    await loginPage.registerLink.click();
    await expect(page).toHaveURL('/auth/register');

    await page.goBack();
    await loginPage.forgotPasswordLink.click();
    await expect(page).toHaveURL('/auth/forgot-password');
  });

  test('Google sign-in is offered', async ({ loginPage }) => {
    // Not clicked: it starts a real OAuth flow with a third party.
    await expect(loginPage.googleButton).toBeVisible();
  });

  test.describe('when the credentials are accepted', { tag: ['@mocked'] }, () => {
    test.use(withMocks(
      mock.respond('POST', '/users/login', { access_token: fakeJwt(), token_type: 'bearer', expires_in: 3600 }),
      mock.respond('GET', '/users/me', fakeUser),
    ));

    test('the customer lands in the account area, signed in', async ({ loginPage, apiMock, page }) => {
      const login = apiMock.waitForRequest('POST', '/users/login');
      await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');

      expect((await login).postDataJSON()).toEqual({ email: fakeUser.email, password: 'Qa-lab-mocked-1!' });
      await expect(page).toHaveURL('/account');
      await expect(loginPage.shell.header.userMenu).toHaveText(`${fakeUser.first_name} ${fakeUser.last_name}`);
      await expect(loginPage.shell.header.signInLink).toHaveCount(0);
    });
  });

  test.describe('when the account uses two-factor authentication', { tag: ['@mocked'] }, () => {
    test.use(withMocks(
      mock.sequence('POST', '/users/login',
        { status: 200, json: { requires_totp: true, access_token: 'qa-lab-pending-totp' } },
        { status: 200, json: { access_token: fakeJwt(), token_type: 'bearer', expires_in: 3600 } }),
      mock.respond('GET', '/users/me', fakeUser),
    ));

    test('the password step asks for a TOTP code, which completes the login', async ({ loginPage, apiMock, page }) => {
      await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');
      await expect(loginPage.totpCode).toBeVisible();
      await expect(loginPage.password.input).toBeHidden();

      const verification = apiMock.waitForRequest('POST', '/users/login');
      await loginPage.verifyTotp('123456');

      expect((await verification).postDataJSON()).toEqual({ totp: '123456', access_token: 'qa-lab-pending-totp' });
      await expect(page).toHaveURL('/account');
    });

    test('a wrong TOTP code is refused and the customer stays on login', { tag: ['@negative'] }, async ({ loginPage, apiMock, page }) => {
      // The first answer asks for a code; the second refuses it, the way the real API refuses a bad credential.
      await apiMock.use(mock.sequence('POST', '/users/login',
        { status: 200, json: { requires_totp: true, access_token: 'qa-lab-pending-totp' } },
        { status: 401, json: { error: 'Unauthorized' } }));
      await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');
      await expect(loginPage.totpCode).toBeVisible();

      const verification = apiMock.waitForResponse('POST', '/users/login');
      await loginPage.verifyTotp('000000');

      expect((await verification).response.status()).toBe(401);
      await expect(loginPage.error).toHaveText('Unauthorized');
      await expect(page).toHaveURL('/auth/login');
      await expect(loginPage.shell.header.userMenu).toHaveCount(0);
    });

    test('an empty TOTP code is refused', { tag: ['@negative'] }, async ({ loginPage }) => {
      await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');

      await loginPage.verifyTotp('');

      await expect(loginPage.error).toHaveText('TOTP code is required');
    });
  });

  test('the show-password button has an accessible name', { tag: ['@a11y', '@bug'] }, async ({ loginPage }) => {
    knownBug('A11Y-02', 'the eye button that shows the password has no accessible name (login, register, profile).');
    await expect(loginPage.showPasswordButton).toBeVisible();

    await expect(loginPage.showPasswordButton, 'A11Y-02: the eye button has an accessible name').toHaveAccessibleName(/show|hide|password/i, { timeout: 2_000 });
  });

  test.describe('when the account is locked', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/login', 423, { error: 'Account locked, too many failed attempts. Please contact the administrator.' })));

    test('the API reason is shown', async ({ loginPage }) => {
      await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');

      await expect(loginPage.error).toHaveText('Account locked, too many failed attempts. Please contact the administrator.');
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
        await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');

        await expect(loginPage.error).toHaveText('Login failed');
        await expect(page).toHaveURL('/auth/login');
      });
    });
  }
});

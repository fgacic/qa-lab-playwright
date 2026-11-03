import { expect, mock, test, withMocks } from '@fixtures';
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

  test('a malformed email and a too-short password are rejected before sending', { tag: ['@negative'] }, async ({ loginPage, page }) => {
    let sent = false;
    page.on('request', (r) => { if (r.url().endsWith('/users/login')) sent = true; });

    await loginPage.login('not-an-email', 'x');

    await expect(loginPage.email.error).toHaveText('Email format is invalid');
    await expect(loginPage.password.error).toHaveText('Password length is invalid');
    expect(sent, 'invalid input must not reach the API').toBe(false);
  });

  test('unknown credentials are refused', { tag: ['@negative', '@smoke'] }, async ({ loginPage, page }) => {
    await loginPage.login('nobody@example.invalid', 'not-a-real-password');

    await expect(loginPage.error).toHaveText('Invalid email or password');
    await expect(page).toHaveURL('/auth/login');
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

    test('the customer lands in the account area, signed in', async ({ loginPage, page }) => {
      await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');

      await expect(page).toHaveURL('/account');
      await expect(loginPage.shell.header.userMenu).toHaveText(`${fakeUser.first_name} ${fakeUser.last_name}`);
      await expect(loginPage.shell.header.signInLink).toHaveCount(0);
    });
  });

  test.describe('when the account is locked', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/login', 423, { error: 'Account locked, too many failed attempts. Please contact the administrator.' })));

    test('the API reason is shown', async ({ loginPage }) => {
      await loginPage.login(fakeUser.email, 'Qa-lab-mocked-1!');

      await expect(loginPage.error).toHaveText('Account locked, too many failed attempts. Please contact the administrator.');
    });
  });

  for (const failure of [mock.fail('POST', '/users/login', 500), mock.abort('POST', '/users/login')]) {
    const how = 'abort' in failure.responses[0] ? 'cannot be reached' : 'answers 500';
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

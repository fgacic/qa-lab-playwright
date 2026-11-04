import { expect, mock, test, withMocks } from '@fixtures';
import { fakeJwt } from '@support/payloads';
import { fakeCustomer } from '@support/test-data';

/**
 * The whole sign-up journey with the auth API mocked: register, log in with the new account,
 * land in the account area. It proves the UI wiring end to end without creating an account.
 * The same journey against the real API is tests/account/real-account.spec.ts.
 */
test.describe('Registration flow (mocked auth API)', { tag: ['@flow', '@mocked'] }, () => {
  const customer = fakeCustomer();
  const me = {
    id: '01QALABNEWCUSTOMER0000000',
    first_name: customer.firstName,
    last_name: customer.lastName,
    email: customer.email,
  };

  test.use(withMocks(
    mock.fail('GET', '/postcode-lookup', 404),
    mock.respond('POST', '/users/register', me, 201),
    mock.respond('POST', '/users/login', { access_token: fakeJwt(), token_type: 'bearer', expires_in: 3600 }),
    mock.respond('GET', '/users/me', me),
  ));

  test('register, log in with the new account and reach the account area', async ({ registerPage, apiMock, page }) => {
    const loginPage = await registerPage.register(customer);
    await expect(page).toHaveURL('/auth/login');

    const login = apiMock.waitForRequest('POST', '/users/login');
    const account = await loginPage.login(customer.email, customer.password);

    expect((await login).postDataJSON()).toEqual({ email: customer.email, password: customer.password });
    await expect(page).toHaveURL('/account');
    await expect(account.title).toHaveText('My account');
    await expect(account.header.userMenu).toHaveText(`${customer.firstName} ${customer.lastName}`);
  });
});

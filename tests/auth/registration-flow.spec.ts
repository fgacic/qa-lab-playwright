import { expect, mock, test, withMocks } from '@fixtures';
import { ACCOUNT_TITLE } from '@pages/account/AccountPage';
import { fakeJwt, fakeUser } from '@support/payloads';
import { fakeCustomer } from '@support/test-data';

/**
 * The whole sign-up journey with the auth API mocked: register, log in with the new account,
 * land in the account area. It proves only the hand-off between the pages, without creating an
 * account: what each request carries is checked where the form lives (register.spec.ts,
 * login.spec.ts). The same journey against the real API is tests/account/real-account.spec.ts.
 */
test.describe('Registration flow (mocked auth API)', { tag: ['@flow', '@mocked'] }, () => {
  // Built once for the describe because the mocks below echo it back as the registered account; the block holds a single test, so a retry
  // re-registers the same fake customer against mocks that carry no state. A second test here must build its own customer.
  const customer = fakeCustomer();
  const me = { ...fakeUser, first_name: customer.firstName, last_name: customer.lastName, email: customer.email };

  test.use(withMocks(
    mock.fail('GET', '/postcode-lookup', 404),
    mock.respond('POST', '/users/register', me, 201),
    mock.respond('POST', '/users/login', { access_token: fakeJwt(), token_type: 'bearer', expires_in: 3600 }),
    mock.respond('GET', '/users/me', me),
  ));

  test('register, log in with the new account and reach the account area', async ({ registerPage, page }) => {
    const loginPage = await registerPage.register(customer);
    await expect(page).toHaveURL('/auth/login');

    const account = await loginPage.login(customer.email, customer.password);

    await expect(page).toHaveURL('/account');
    await expect(account.title).toHaveText(ACCOUNT_TITLE);
    await expect(account.header.userMenu).toHaveText(`${customer.firstName} ${customer.lastName}`);
  });
});

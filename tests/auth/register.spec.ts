import { expect, mock, test, withMocks } from '@fixtures';
import { knownBug } from '@support/known-bug';
import { fakeCustomer } from '@support/test-data';

/**
 * Nothing here creates a real account. Submissions with valid data are answered by a mocked
 * POST /users/register; real sign-up lives in tests/account (gated by RUN_ACCOUNT_TESTS).
 */
test.describe('Registration form', () => {
  const required = {
    'First name': 'First name is required',
    'Last name': 'Last name is required',
    'Date of birth': 'Please enter a valid date in YYYY-MM-DD format. Date of Birth is required',
    Country: 'Country is required',
    'Postal code': 'Postcode is required',
    'House number': 'House number is required',
    Street: 'Street is required',
    City: 'City is required',
    State: 'State is required',
    Phone: 'Phone is required.',
    Email: 'Email is required',
    Password: 'Password is required Password must be minimal 6 characters long. Password can not include invalid characters.',
  } as const;

  test('an empty form flags every required field', { tag: ['@negative'] }, async ({ registerPage }) => {
    await registerPage.submit();

    for (const [field, message] of Object.entries(required)) {
      await expect(registerPage.fields[field as keyof typeof required].error, field).toHaveText(message);
    }
  });

  const invalid = [
    { field: 'dateOfBirth', value: '01/01/1990', message: 'Please enter a valid date in YYYY-MM-DD format.' },
    { field: 'dateOfBirth', value: '2020-13-45', message: 'Please enter a valid date in YYYY-MM-DD format.' },
    { field: 'phone', value: 'abc', message: 'Only numbers are allowed.' },
    { field: 'email', value: 'not-an-email', message: 'Email format is invalid' },
    { field: 'password', value: 'a', message: 'Password must be minimal 6 characters long. Password can not include invalid characters.' },
  ] as const;

  for (const { field, value, message } of invalid) {
    test(`${field} "${value}" is rejected`, { tag: ['@negative'] }, async ({ registerPage }) => {
      await registerPage[field].input.fill(value);
      await registerPage.submit();

      await expect(registerPage[field].error).toHaveText(message);
    });
  }

  test('a birth date in the future is rejected', { tag: ['@negative', '@bug'] }, async ({ registerPage }) => {
    knownBug('BUG-18', 'the form accepts a date of birth in the future (2099-01-01) without a validation label.');
    await registerPage.dateOfBirth.input.fill('2099-01-01');
    await registerPage.submit();
    await expect(registerPage.firstName.error).toBeVisible();

    await expect(registerPage.dateOfBirth.error).toBeVisible({ timeout: 5_000 });
  });

  test('the form lists the password rules and can reveal the password', async ({ registerPage }) => {
    await expect(registerPage.passwordRules).toHaveText([
      'Be at least 8 characters long',
      'Contain both uppercase and lowercase letters',
      'Include at least one number',
      'Have at least one special symbol (e.g., @, #, $, etc.)',
    ]);

    await registerPage.password.input.fill('Qa-lab-visible-1!');
    await registerPage.showPasswordButton.click();
    await expect(registerPage.password.input).toHaveAttribute('type', 'text');
  });

  test.describe('when the postcode lookup knows the address', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.respond('GET', '/postcode-lookup', { street: 'Mockstraat', house_number: '1', city: 'Mockstad', state: 'Mockland', country: 'NL', postcode: '1234 AB' })));

    test('street, city and state are filled in', async ({ registerPage }) => {
      await registerPage.country.input.selectOption('NL');
      await registerPage.postalCode.input.fill('1234 AB');
      await registerPage.houseNumber.input.fill('1');

      await expect(registerPage.street.input).toHaveValue('Mockstraat');
      await expect(registerPage.city.input).toHaveValue('Mockstad');
      await expect(registerPage.state.input).toHaveValue('Mockland');
    });
  });

  test.describe('when registration succeeds', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 404), mock.respond('POST', '/users/register', { id: '01QALABNEWCUSTOMER0000000' }, 201)));

    test('the form sends the customer and moves on to the login page', async ({ registerPage, apiMock, page }) => {
      const customer = fakeCustomer();
      const sent = apiMock.waitForRequest('POST', '/users/register');

      await registerPage.register(customer);

      expect((await sent).postDataJSON()).toEqual({
        first_name: customer.firstName,
        last_name: customer.lastName,
        dob: customer.dateOfBirth,
        phone: customer.phone,
        email: customer.email,
        password: customer.password,
        address: {
          street: customer.address.street,
          city: customer.address.city,
          state: customer.address.state,
          country: customer.address.country,
          postal_code: customer.address.postalCode,
        },
      });
      await expect(page).toHaveURL('/auth/login');
    });
  });

  test.describe('when the API rejects a field other than the email', { tag: ['@mocked', '@negative'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 404), mock.fail('POST', '/users/register', 422, { first_name: ['The first name field must not be greater than 40 characters.'] })));

    test('the API reason is shown', async ({ registerPage, page }) => {
      await registerPage.register(fakeCustomer());

      await expect(registerPage.error).toHaveText('The first name field must not be greater than 40 characters.');
      await expect(page).toHaveURL('/auth/register');
    });
  });

  const failures = [
    { status: 422, json: { email: ['A customer with this email address already exists.'] }, shown: 'A customer with this email address already exists.' },
    { status: 500, json: { message: 'Server Error' }, shown: 'Server Error' },
  ];
  for (const { status, json, shown } of failures) {
    test.describe(`when registration answers ${status}`, { tag: ['@mocked', '@negative'] }, () => {
      test.use(withMocks(mock.fail('GET', '/postcode-lookup', 404), mock.fail('POST', '/users/register', status, json)));

      test('the reason is shown and the form stays', async ({ registerPage, page }) => {
        await registerPage.register(fakeCustomer());

        await expect(registerPage.error).toHaveText(shown);
        await expect(page).toHaveURL('/auth/register');
      });
    });
  }
});

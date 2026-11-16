import { expect, mock, test, withMocks } from '@fixtures';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';
import { fakeCustomer } from '@support/test-data';

/** A password the form accepts, typed where a test only needs some password, and the id the mocked register answers with. */
const VISIBLE_PASSWORD = 'Qa-lab-visible-1!';
const NEW_CUSTOMER_ID = '01QALABNEWCUSTOMER0000000';

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

  // The form's own validation must stop the negative tests below. Nothing answers POST /users/register in
  // them, so the guard refuses a submission that should never leave (the real shop gets no account), and
  // `expectNoRequest` watches a short window after the labels appear to prove none was sent.

  test('an empty form flags every required field', { tag: ['@negative'] }, async ({ registerPage, apiMock }) => {
    await apiMock.blockUnmockedWrites();

    await registerPage.submit();

    for (const [field, message] of Object.entries(required)) {
      await expect(registerPage.fields[field as keyof typeof required].error, field).toHaveText(message);
    }
    await apiMock.expectNoRequest('POST', '/users/register');
  });

  const invalid = [
    { field: 'dateOfBirth', label: 'date of birth', value: '01/01/1990', message: 'Please enter a valid date in YYYY-MM-DD format.' },
    { field: 'dateOfBirth', label: 'date of birth', value: '2020-13-45', message: 'Please enter a valid date in YYYY-MM-DD format.' },
    { field: 'phone', label: 'phone number', value: 'abc', message: 'Only numbers are allowed.' },
    { field: 'email', label: 'email', value: 'not-an-email', message: 'Email format is invalid' },
    { field: 'password', label: 'password', value: 'a', message: 'Password must be minimal 6 characters long. Password can not include invalid characters.' },
  ] as const;

  for (const { field, label, value, message } of invalid) {
    test(`a ${label} of "${value}" is rejected`, { tag: ['@negative'] }, async ({ registerPage, apiMock }) => {
      await apiMock.blockUnmockedWrites();

      await registerPage[field].input.fill(value);
      await registerPage.submit();

      await expect(registerPage[field].error).toHaveText(message);
      await apiMock.expectNoRequest('POST', '/users/register');
    });
  }

  test('a birth date in the future is rejected', { tag: ['@negative', '@bug'] }, async ({ registerPage, apiMock }) => {
    knownBug('BUG-18', 'the form accepts a date of birth in the future (2099-01-01) without a validation label.', { absence: true });
    await apiMock.blockUnmockedWrites();
    await registerPage.dateOfBirth.input.fill('2099-01-01');
    await registerPage.submit();
    // The other required fields are empty, so the form stops here whether or not the date is flagged.
    await expect(registerPage.firstName.error).toBeVisible();

    await expect(registerPage.dateOfBirth.error, 'BUG-18: a future birth date is flagged').toBeVisible({ timeout: BUG_TIMEOUT });
  });

  test('the form lists the password rules', async ({ registerPage }) => {
    await expect(registerPage.passwordRules).toHaveText([
      'Be at least 8 characters long',
      'Contain both uppercase and lowercase letters',
      'Include at least one number',
      'Have at least one special symbol (e.g., @, #, $, etc.)',
    ]);
  });

  test('the eye button shows and hides the password', async ({ registerPage }) => {
    await registerPage.password.input.fill(VISIBLE_PASSWORD);
    await expect(registerPage.password.input).toHaveAttribute('type', 'password');

    await registerPage.showPasswordButton.click();
    await expect(registerPage.password.input).toHaveAttribute('type', 'text');
    await expect(registerPage.password.input).toHaveValue(VISIBLE_PASSWORD);

    await registerPage.showPasswordButton.click();

    await expect(registerPage.password.input).toHaveAttribute('type', 'password');
  });

  test('the password rules and the validation message ask for the same minimum length', { tag: ['@negative', '@bug'] }, async ({ registerPage, apiMock }) => {
    knownBug('BUG-31', 'the page lists "at least 8 characters" for the password but the validation message says "minimal 6 characters long".');
    await apiMock.blockUnmockedWrites();
    await registerPage.password.input.fill('a');
    await registerPage.submit();
    // Both statements exist, whichever number a fix settles on.
    await expect(registerPage.passwordRules.first()).toContainText(/\d+ characters/);
    await expect(registerPage.password.error).toContainText(/\d+ characters/);
    const rule = await registerPage.passwordRules.first().innerText();
    const listedMinimum = /(\d+) characters/.exec(rule)?.[1];

    await expect(registerPage.password.error, `BUG-31: the message names the minimum the rules list ("${rule}")`).toContainText(new RegExp(`\\b${listedMinimum} characters`), { timeout: BUG_TIMEOUT });
  });

  // The minimum the page lists is 8 (BUG-31 is about the validation message saying 6). Probed: the form really enforces 8, so the
  // pairs are 6 against 8 (the number the message names) and 7 against 8 (the number the rules list). A password is `Ab1!` plus filler,
  // so only its length changes between a pair.
  const passwordOfLength = (length: number) => `Ab1!${'x'.repeat(length - 4)}`;

  for (const length of [5, 6, 7]) {
    test(`a password of ${length} characters is rejected by the form`, { tag: ['@negative'] }, async ({ registerPage, apiMock }) => {
      await apiMock.blockUnmockedWrites();
      await registerPage.password.input.fill(passwordOfLength(length));

      await registerPage.submit();

      // Whatever number the message names (BUG-31), it says the password is too short and nothing is sent.
      await expect(registerPage.password.error).toContainText(/\d+ characters/);
      await apiMock.expectNoRequest('POST', '/users/register');
    });
  }

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

  test.describe('when the postcode lookup fails', { tag: ['@mocked', '@negative'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 500)));

    test('the address stays as typed and the form is still usable', async ({ registerPage }) => {
      await registerPage.street.input.fill('Typed Street');
      await registerPage.country.input.selectOption('NL');
      await registerPage.postalCode.input.fill('1234 AB');
      await registerPage.houseNumber.input.fill('1');

      await expect(registerPage.street.input).toHaveValue('Typed Street');
      await registerPage.city.input.fill('Typed City');
      await expect(registerPage.city.input).toHaveValue('Typed City');
      await expect(registerPage.error).toHaveCount(0);
    });
  });

  test.describe('when registration succeeds', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 404), mock.respond('POST', '/users/register', { id: NEW_CUSTOMER_ID }, 201)));

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

    // The accepting side of the pairs: 8 is the shortest password the form lets through.
    test('a password of 8 characters is accepted by the form', async ({ registerPage, apiMock, page }) => {
      const password = passwordOfLength(8);
      const sent = apiMock.waitForRequest('POST', '/users/register');

      await registerPage.register({ ...fakeCustomer(), password });

      expect((await sent).postDataJSON()).toMatchObject({ password });
      await expect(page).toHaveURL('/auth/login');
    });
  });

  test.describe('when registration is submitted with Enter', { tag: ['@mocked'] }, () => {
    test.use(withMocks(mock.fail('GET', '/postcode-lookup', 404), mock.respond('POST', '/users/register', { id: NEW_CUSTOMER_ID }, 201)));

    test('Enter in the email field registers as the button does', async ({ registerPage, apiMock, page }) => {
      const customer = fakeCustomer();
      const sent = apiMock.waitForRequest('POST', '/users/register');

      await registerPage.registerWithEnter(customer, 'email');

      expect((await sent).postDataJSON()).toMatchObject({ email: customer.email });
      await expect(page).toHaveURL('/auth/login');
    });

    test('Enter in the password field registers as the button does', { tag: ['@bug'] }, async ({ registerPage, page }) => {
      knownBug('BUG-36', 'Enter in the password field of a completely filled registration form answers "Password is required" and registers nobody.');
      const customer = fakeCustomer();
      await registerPage.fillIn(customer);
      await expect(registerPage.password.input).toHaveValue(customer.password);

      await registerPage.password.input.press('Enter');

      await expect(page, 'BUG-36: Enter in the password field submits the registration').toHaveURL('/auth/login', { timeout: BUG_TIMEOUT });
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

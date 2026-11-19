import { expect, mock, test, withMocks } from '@fixtures';
import { ADM_14, ADMIN_MESSAGES, withLoggedFailure } from '@pages/admin/alerts';
import { REFUSED_STATUSES, customer, paginated } from '@support/admin-payloads';
import { BUG_TIMEOUT, knownBug } from '@support/known-bug';

/** The error the SPA throws after the API accepts a new user (ADM-21): the same pattern as the suite-wide allowance (console-guard.ts), read from the log's text or the arguments the page passed, whichever engine prints which. */
const NEW_USER_ERROR = /NG01002|Must supply a value for form control/;
/** The user the add form is filled in with: only the required fields, the others stay empty and the form accepts that. */
const newUser = { firstName: 'Newly', lastName: 'Added', dateOfBirth: '1991-02-03', street: 'Test Street 2', city: 'Testville', country: 'NL', email: 'newly.added@example.com' };

/** What the API says for an email another customer already has: the mocked body and the text the form must show. */
const EMAIL_TAKEN = 'A customer with this email address already exists.';
/** The heading of the form that adds a user. */
const ADD_USER = 'Add User';
/** The fields the add form cannot be saved without (Postal code, State, Phone and Password are optional). */
const REQUIRED_FIELDS = ['First Name', 'Last Name', 'Date of birth', 'Street', 'City', 'Country', 'Email'];
/** An email the form must refuse: no at sign, no domain. */
const MALFORMED_EMAIL = 'not-an-email';
/** What a user who has never failed to sign in shows in the form. */
const NO_FAILED_ATTEMPTS = '0';
/** The first name an edit gives the user. */
const RENAMED = 'Renamed';
/** The first name the searched-for user has, and the term typed into the search box. */
const SEARCHED = 'searched';

test.describe('Admin users (mocked back office)', { tag: ['@mocked'] }, () => {
  test('the list shows name and email', async ({ adminUsers }) => {
    await expect(adminUsers.table.row(customer.email)).toContainText(`${customer.first_name} ${customer.last_name}`);
  });

  test('searching sends the term and lists the matches', async ({ adminUsers, apiMock }) => {
    // The answer differs from the full list, so a table that shows it has really been replaced.
    const match = { ...customer, id: '01QALABUSERHIT0000000000', first_name: SEARCHED, email: 'searched.hit@example.com' };
    await apiMock.use(mock.respond('QUERY', '/users/search', paginated([match])));
    const sent = apiMock.waitForRequest('QUERY', '/users/search');

    await adminUsers.search.searchFor(SEARCHED);

    expect((await sent).postDataJSON()).toMatchObject({ q: SEARCHED });
    await expect(adminUsers.table.row(match.email)).toContainText(match.first_name);
    await expect(adminUsers.table.row(customer.email)).toHaveCount(0);
  });

  test('a new user is saved with what was entered', async ({ adminUsers, apiMock }) => {
    const form = await adminUsers.add();
    const created = apiMock.waitForRequest('POST', '/users/register');

    await form.fillIn(newUser);
    await form.chrome.save();

    expect((await created).postDataJSON()).toMatchObject({ first_name: newUser.firstName, last_name: newUser.lastName, dob: newUser.dateOfBirth, email: newUser.email, address: { street: newUser.street, city: newUser.city, country: newUser.country } });
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeVisible();
  });

  test('a new user needs the required fields', { tag: ['@negative'] }, async ({ adminUsers }) => {
    const form = await adminUsers.add();
    await expect(form.chrome.heading).toHaveText(ADD_USER);

    await form.chrome.save();

    for (const field of REQUIRED_FIELDS) {
      await expect(form.chrome.required(field), field).toBeVisible();
    }
  });

  test('a new user needs a well-formed email', { tag: ['@negative'] }, async ({ adminUsers, apiMock }) => {
    const form = await adminUsers.add();
    await expect(form.chrome.heading).toHaveText(ADD_USER);
    await form.fillIn({ ...newUser, email: MALFORMED_EMAIL });
    const before = await apiMock.mark();

    await form.chrome.save();

    // The form's own check stops it (it shows an alert box, with no text in it: not a pin, the wording is not what is tested here).
    await expect(apiMock.expectNoRequest('POST', '/users/register', { since: before }), 'a malformed email is not sent to the API').resolves.toBeUndefined();
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeHidden();
  });

  test('editing loads the user, including the account flags, and saves the change', async ({ adminUsers, apiMock }) => {
    const form = await adminUsers.edit(customer.email);
    await expect(form.email).toHaveValue(customer.email);
    await expect(form.enabled).toBeChecked();
    await expect(form.failedLoginAttempts).toHaveValue(NO_FAILED_ATTEMPTS);
    const saved = apiMock.waitForRequest('PUT', `/users/${customer.id}`);

    await form.firstName.fill(RENAMED);
    await form.enabled.uncheck();
    await form.chrome.save();

    expect((await saved).postDataJSON()).toMatchObject({ first_name: RENAMED, enabled: false, email: customer.email });
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeVisible();
  });

  test('the password of a new user is typed into a masked field', { tag: ['@bug'] }, async ({ adminUsers }) => {
    knownBug('ADM-17', 'the admin user form shows the password in clear text (an <input type="text">).');
    const form = await adminUsers.add();
    await expect(form.chrome.heading).toHaveText(ADD_USER);
    await expect(form.password).toBeVisible();

    await expect(form.password, 'ADM-17: the password field is masked').toHaveAttribute('type', 'password', { timeout: BUG_TIMEOUT });
  });

  test('saving a new user raises no application error', { tag: ['@bug'] }, async ({ adminUsers, consoleGuard }) => {
    knownBug('ADM-21', 'after the API accepts a new user (201) the SPA throws an unhandled Angular error (NG01002, "Must supply a value for form control") although the form says "User saved!".');
    const form = await adminUsers.add();
    await form.fillIn(newUser);
    await form.chrome.save();
    await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeVisible();

    await expect(consoleGuard.expectNoneLogged(NEW_USER_ERROR), 'ADM-21: saving a new user raises no application error').resolves.toBeUndefined();
  });

  test.describe('when the new user is refused', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('POST', '/users/register', 422, { email: [EMAIL_TAKEN] })));

    test('a refused new user shows the API\'s reason and is not reported as saved', async ({ adminUsers }) => {
      const form = await adminUsers.add();

      await form.fillIn({ ...newUser, email: customer.email });
      await form.chrome.save();

      await expect(form.chrome.alert(EMAIL_TAKEN)).toBeVisible();
      await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeHidden();
    });
  });

  test.describe('when the user cannot be loaded', { tag: ['@negative', '@bug'] }, () => {
    test.use(withLoggedFailure(mock.fail('GET', /^\/users\/[^/]+$/, 500)));

    test('the admin is told the user could not be loaded', async ({ adminUsers, apiMock }) => {
      knownBug('ADM-14', ADM_14, { absence: true });
      const failed = apiMock.waitForResponse('GET', /^\/users\/[^/]+$/);

      const form = await adminUsers.edit(customer.email);
      await failed;
      await expect(form.chrome.heading).toBeVisible();

      // Any alert, or plain error text, will do: the pin does not prescribe the form or the wording.
      await expect(form.chrome.failure, 'ADM-14: a failed user load tells the admin').toBeVisible({ timeout: BUG_TIMEOUT });
    });
  });

  test.describe('when the email is already taken', { tag: ['@negative'] }, () => {
    test.use(withMocks(mock.fail('PUT', /^\/users\/[^/]+$/, 422, { email: [EMAIL_TAKEN] })));

    test('a taken email on an edit shows the API\'s reason', async ({ adminUsers }) => {
      const form = await adminUsers.edit(customer.email);
      await expect(form.email).toHaveValue(customer.email);

      await form.chrome.save();

      await expect(form.chrome.alert(EMAIL_TAKEN)).toBeVisible();
    });
  });

  for (const status of REFUSED_STATUSES) {
    test.describe(`when saving an edited user is refused (${status})`, { tag: ['@negative'] }, () => {
      test.use(withLoggedFailure(mock.fail('PUT', /^\/users\/[^/]+$/, status, { message: 'The user could not be saved.' })));

      test('the failure is shown and nothing is reported as saved', async ({ adminUsers, apiMock }) => {
        const form = await adminUsers.edit(customer.email);
        await expect(form.email).toHaveValue(customer.email);
        const refused = apiMock.waitForResponse('PUT', `/users/${customer.id}`);

        await form.firstName.fill(RENAMED);
        await form.chrome.save();
        expect((await refused).response.status(), 'the mocked refusal was sent').toBe(status);

        await expect(form.chrome.failure).toBeVisible();
        await expect(form.chrome.alert(ADMIN_MESSAGES.userSaved)).toBeHidden();
      });
    });
  }
});
